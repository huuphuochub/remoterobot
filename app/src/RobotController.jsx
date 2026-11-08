"use client"
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { OpusDecoder } from 'opus-decoder';
import { createEncoder } from 'libopus-wasm';

const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const CONTROL_TOPIC = 'phuoccam/control'; // dieu khien robot
const BATTATCAM = 'phuoccam/mode_control'; // bat tat dieu khien
const CAMERA_TOPIC = 'phuoccam/photo'; //live video
const chat_control = 'phuoccam/chat_control'; // bat tat chat
const light_control = 'phuoccam/light_control'; // bat tat den
const horn_control = 'phuoccam/horn_control'; // bat tat coi
const MIC_TOPIC = 'phuoccam/audio/down'; // web thu am -> gui xuong thiet bi
const SPEAKER_TOPIC = 'phuoccam/audio/up'; // thiet bi gui len -> web phat

export default function RobotController() {
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState('Đang kết nối...');
  const [activeCommand, setActiveCommand] = useState('stop');
  const  [chat,setChat] = useState(false);

  const [isControlMode, setIsControlMode] = useState(false);
  const [isLightOn, setIsLightOn] = useState(false);
  const [isHornOn, setIsHornOn] = useState(false);
  const [cameraFrame, setCameraFrame] = useState(null);

  // ==== State cho audio ====
  const [isMicOn, setIsMicOn] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  const pressedKeysRef = useRef(new Set());
  const clientRef = useRef(null);

  // ==== Ref cho audio ====
  const opusDecoderRef = useRef(null);
  const audioCtxRef = useRef(null); // dùng cho phát loa (decode)
  const micEncoderRef = useRef(null);
  const micStreamRef = useRef(null);
  const micCtxRef = useRef(null);
  const micWorkletRef = useRef(null);
  const isPlayingRef = useRef(false); // tránh chồng âm khi decode

  // ==== Khởi tạo decoder Opus + AudioContext phát loa ====
  useEffect(() => {
    const init = async () => {
      try {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000, // khớp mono 16kHz của thiết bị
        });
        const decoder = new OpusDecoder();
        await decoder.ready;
        opusDecoderRef.current = decoder;
        console.log('[opus] decoder ready');
      } catch (e) {
        console.error('[opus] decoder init fail', e);
      }
    };
    init();
    return () => {
      opusDecoderRef.current?.free();
      audioCtxRef.current?.close();
    };
  }, []);

  // ==== Kiểm tra quyền mic/audio lần đầu vào web ====
  useEffect(() => {
    const asked = localStorage.getItem('audio_perm_asked');
    if (!asked) {
      setShowPermissionModal(true);
    }
  }, []);

  const requestPermissions = async () => {
    try {
      // Xin quyền mic (đồng thời đánh thức AudioContext)
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      localStorage.setItem('audio_perm_asked', '1');
      setShowPermissionModal(false);
    } catch (e) {
      console.error('Không được cấp quyền mic', e);
      alert('Bạn cần cho phép quyền micro để dùng tính năng âm thanh.');
    }
  };

  // ==== MQTT ====
  useEffect(() => {
    const clientId = `mobile_web_${Math.random().toString(16).substring(2, 8)}`;
    const mqttClient = mqtt.connect(MQTT_BROKER, {
      clientId: clientId,
      clean: true,
      reconnectPeriod: 2000,
    });

    mqttClient.on('connect', () => {
      setIsConnected(true);
      setStatusText('Đã kết nối Robot!');
      mqttClient.subscribe(CAMERA_TOPIC);
      // Nghe thiết bị gửi lên (audio/up)
      mqttClient.subscribe(SPEAKER_TOPIC);
    });

    mqttClient.on('reconnect', () => {
      setIsConnected(false);
      setStatusText('Đang nối lại...');
    });

    mqttClient.on('error', () => {
      setIsConnected(false);
      setStatusText('Lỗi kết nối!');
    });

    mqttClient.on('message', async (topic, message) => {
      if (topic === CAMERA_TOPIC) {
        const blob = new Blob([message], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setCameraFrame(url);
        return;
      }

      // ==== Nhận frame Opus từ thiết bị -> decode -> phát loa ====
      if (topic === SPEAKER_TOPIC) {
        if (!opusDecoderRef.current || !audioCtxRef.current) return;
        if (isPlayingRef.current) return; // tránh chồng chéo
        isPlayingRef.current = true;
        try {
          const { channelData, samplesDecoded, sampleRate } =
            opusDecoderRef.current.decodeFrame(new Uint8Array(message));
          if (!samplesDecoded) { isPlayingRef.current = false; return; }

          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') await ctx.resume();

          const buffer = ctx.createBuffer(1, samplesDecoded, sampleRate);
          buffer.copyToChannel(channelData[0], 0);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.onended = () => { isPlayingRef.current = false; };
          src.start();
        } catch (e) {
          console.error('[opus] decode fail', e);
          isPlayingRef.current = false;
        }
      }
    });

    clientRef.current = mqttClient;

    return () => {
      if (mqttClient) mqttClient.end();
    };
  }, []);

  // ==== Thu âm: AudioWorklet -> PCM -> Opus encode -> publish audio/down ====
  const startMic = async () => {
    try {
      // 1. Encoder Opus mono 16kHz
      const encoder = await createEncoder({
        sampleRate: 16000,
        channels: 1,
        application: 2048, // VOIP
      });
      micEncoderRef.current = encoder;
      const frameSize = encoder.frameSize; // 320 (20ms @ 16kHz)
      console.log('[opus] enc frameSize =', frameSize);

      // 2. Lấy mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      // 3. AudioContext riêng cho mic
      const micCtx = new AudioContext({ sampleRate: 16000 });
      micCtxRef.current = micCtx;
      if (micCtx.state === 'suspended') await micCtx.resume();
      console.log('[mic] sampleRate =', micCtx.sampleRate);

      // 4. Worklet lấy PCM Float32
      const workletCode = `
        class PCMCapture extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
            return true;
          }
        }
        registerProcessor('pcm-capture', PCMCapture);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await micCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = micCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(micCtx, 'pcm-capture');
      micWorkletRef.current = worklet;

      // 5. Gom PCM đủ frameSize -> encode -> publish
      let pcmBuffer = new Float32Array(0);
      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        const merged = new Float32Array(pcmBuffer.length + chunk.length);
        merged.set(pcmBuffer);
        merged.set(chunk, pcmBuffer.length);
        pcmBuffer = merged;

        while (pcmBuffer.length >= frameSize) {
          const frame = pcmBuffer.slice(0, frameSize);
          pcmBuffer = pcmBuffer.slice(frameSize);
          try {
            const opusPacket = encoder.encodeFloat(frame);
            if (opusPacket && opusPacket.length && clientRef.current?.connected) {
              clientRef.current.publish(MIC_TOPIC, opusPacket, { qos: 0 });
            }
          } catch (err) {
            console.error('[opus] encode fail', err);
          }
        }
      };

      source.connect(worklet);
      // Không connect tới destination để tránh echo

      setIsMicOn(true);
    } catch (e) {
      console.error('startMic fail', e);
      alert('Không thể bật micro: ' + e.message);
    }
  };

  const stopMic = () => {
    micWorkletRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micCtxRef.current?.close();
    micEncoderRef.current?.free();
    micWorkletRef.current = null;
    micStreamRef.current = null;
    micCtxRef.current = null;
    micEncoderRef.current = null;
    setIsMicOn(false);
  };

  const toggleMic = () => {
    if (isMicOn) stopMic();
    else startMic();
  };

  // ==== Các hàm cũ giữ nguyên ====
  const computeAndSendCommand = useCallback(() => {
    const keys = pressedKeysRef.current;
    let newCmd = 'stop';

    const hasUp = keys.has('up');
    const hasDown = keys.has('down');
    const hasLeft = keys.has('left');
    const hasRight = keys.has('right');

    if (hasUp && hasLeft) newCmd = 'forward_left';
    else if (hasUp && hasRight) newCmd = 'forward_right';
    else if (hasDown && hasLeft) newCmd = 'backward_left';
    else if (hasDown && hasRight) newCmd = 'backward_right';
    else if (hasUp) newCmd = 'forward';
    else if (hasDown) newCmd = 'backward';
    else if (hasLeft) newCmd = 'turn_left';
    else if (hasRight) newCmd = 'turn_right';
    else newCmd = 'stop';

    setActiveCommand(newCmd);

    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(CONTROL_TOPIC, newCmd, { qos: 0 });
    }
  }, [isControlMode]);

  const toggleControlMode = () => {
    const nextState = !isControlMode;
    setIsControlMode(nextState);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(BATTATCAM, nextState ? 'on' : 'off', { qos: 0 });
    }
  };

  const toggleLight = () => {
    const nextState = !isLightOn;
    setIsLightOn(nextState);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(light_control, nextState ? 'on' : 'off', { qos: 0 });
    }
  };

  const toggleHorn = (state) => {
    setIsHornOn(state);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(horn_control, state ? 'on' : 'off', { qos: 0 });
    }
  };

  const toggleChat = () => {
     setChat(!chat);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(chat_control, !chat ? 'on' : 'off', { qos: 0 });
    }
  }
  const handleTouchStart = (key, e) => {
    if (e.cancelable) e.preventDefault();
    pressedKeysRef.current.add(key);
    computeAndSendCommand();
  };

  const handleTouchEnd = (key, e) => {
    if (e.cancelable) e.preventDefault();
    pressedKeysRef.current.delete(key);
    computeAndSendCommand();
  };

  useEffect(() => {
    const keyMap = {
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
    };

    const handleKeyDown = (e) => {
      if (e.repeat) return;
      const key = keyMap[e.key];
      if (key) {
        pressedKeysRef.current.add(key);
        computeAndSendCommand();
      }
    };

    const handleKeyUp = (e) => {
      const key = keyMap[e.key];
      if (key) {
        pressedKeysRef.current.delete(key);
        computeAndSendCommand();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [computeAndSendCommand]);

  const getNavBtnClass = (key) => {
    const isPressed = pressedKeysRef.current.has(key);
    const baseStyles = "w-16 h-16 rounded-2xl text-2xl font-black flex items-center justify-center select-none [-webkit-user-select:none] [touch-action:none] cursor-pointer transition-all duration-100 ease-out active:scale-90";
    const stateStyles = isPressed 
      ? "bg-gradient-to-tr from-blue-600 to-indigo-500 text-white border-2 border-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.8)] scale-95 translate-y-0.5" 
      : "bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700/80 shadow-[0_4px_12px_rgba(0,0,0,0.5)]";
    return `${baseStyles} ${stateStyles}`;
  };

  return (
    <div className="fixed top-0 left-0 w-screen h-screen bg-slate-950 text-white font-sans overflow-hidden z-[99999]  select-none">
      
      {/* ==== Modal xin quyền mic/audio lần đầu ==== */}
      {showPermissionModal && (
        <div className="absolute inset-0 z-[100000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl mb-2">🎤🔊</div>
            <h2 className="text-lg font-bold mb-2">Cần quyền âm thanh</h2>
            <p className="text-slate-400 text-sm mb-4">
              Để đàm thoại với robot (nghe loa và nói qua micro), vui lòng cho phép
              quyền micro và phát âm thanh khi trình duyệt hỏi.
            </p>
            <button
              onClick={requestPermissions}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-sm"
            >
              Cho phép & Tiếp tục
            </button>
            <button
              onClick={() => { localStorage.setItem('audio_perm_asked','1'); setShowPermissionModal(false); }}
              className="w-full mt-2 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
            >
              Bỏ qua
            </button>
          </div>
        </div>
      )}

      {/* Hiệu ứng nền */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30 ">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600 rounded-full blur-[120px]"></div>
      </div>

      {/* Container chính xoay ngang màn hình */}
      <div className="absolute top-1/2 left-1/2 w-[100vh] h-[100vw] -translate-x-1/2  -translate-y-1/2 rotate-90 origin-center flex flex-row items-center justify-between p-3 box-border gap-2 ">
        
        {/* 🟢 CỘT TRÁI: Tiến / Lùi */}
        <div className="flex flex-col gap-4 items-center justify-center w-[12%] shrink-0">
          <button 
            className={getNavBtnClass('up')}
            onTouchStart={(e) => handleTouchStart('up', e)}
            onTouchEnd={(e) => handleTouchEnd('up', e)}
            onMouseDown={() => { pressedKeysRef.current.add('up'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('up'); computeAndSendCommand(); }}
          >
            ▲
          </button>

          <button 
            className={getNavBtnClass('down')}
            onTouchStart={(e) => handleTouchStart('down', e)}
            onTouchEnd={(e) => handleTouchEnd('down', e)}
            onMouseDown={() => { pressedKeysRef.current.add('down'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('down'); computeAndSendCommand(); }}
          >
            ▼
          </button>
        </div>

        {/* 🔴 KHU VỰC GIỮA */}
        <div className="flex-1 flex flex-col items-center justify-between h-full w-full px-1 py-0.5 overflow-hidden mb-10">
          
          <div className="flex items-center gap-2.5 bg-slate-900/70 backdrop-blur-md px-3 py-1 rounded-full border border-slate-800 shadow-md shrink-0">
            <span className="font-bold text-[11px] tracking-wide bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
              🤖 RONALDO BOT
            </span>
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1.5 ${
              isConnected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
              {statusText}
            </div>
          </div>

          <div className="w-full flex-1 bg-black/90 rounded-2xl border border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.6)] flex items-center justify-center overflow-hidden relative my-1.5">
            {cameraFrame ? (
              <img 
                src={cameraFrame} 
                alt="Camera Stream" 
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-slate-500 text-xs">
                <span className="text-xl animate-bounce">📷</span>
                <span>Đang chờ hình ảnh từ Camera...</span>
              </div>
            )}

            <div className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/50 text-[10px] shadow-md flex items-center gap-1">
              <span className="text-slate-400">Lệnh:</span>
              <strong className={activeCommand === 'stop' ? 'text-red-400 font-bold' : 'text-cyan-400 font-bold'}>
                {activeCommand.toUpperCase()}
              </strong>
            </div>
          </div>

          <div className="w-full flex items-center justify-center gap-2  py-1 shrink-0 no-scrollbar absolute bottom-2">
            <button 
              onClick={toggleControlMode}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-md ${
                isControlMode 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] border border-emerald-400/40' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              {isControlMode ? '🎮 Đang Điều Khiển' : '⚪ Bật Điều Khiển'}
            </button>

            <button 
              onClick={toggleLight}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-md ${
                isLightOn 
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)] border border-amber-300' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              💡 {isLightOn ? 'Tắt Đèn' : 'Bật Đèn'}
            </button>

             <button 
              onClick={toggleChat}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-md ${
                chat 
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)] border border-amber-300' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              💡 {chat ? 'Trò chuyện' : 'Ngủ'}
            </button>

            <button 
              onTouchStart={() => toggleHorn(true)}
              onTouchEnd={() => toggleHorn(false)}
              onMouseDown={() => toggleHorn(true)}
              onMouseUp={() => toggleHorn(false)}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-md ${
                isHornOn 
                  ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] border border-red-400' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              📢 Còi
            </button>

            {/* ==== NÚT MIC THÊM MỚI ==== */}
            <button
              onClick={toggleMic}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-md ${
                isMicOn
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)] border border-rose-400 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              🎤 {isMicOn ? 'Đang Nói' : 'Mic'}
            </button>
          </div>
        </div>

        {/* 🔵 CỘT PHẢI: Trái / Phải */}
        <div className="flex flex-row gap-4 items-center justify-center w-[12%] shrink-0">
          <button 
            className={getNavBtnClass('left')}
            onTouchStart={(e) => handleTouchStart('left', e)}
            onTouchEnd={(e) => handleTouchEnd('left', e)}
            onMouseDown={() => { pressedKeysRef.current.add('left'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('left'); computeAndSendCommand(); }}
          >
            ◄
          </button>

          <button 
            className={getNavBtnClass('right')}
            onTouchStart={(e) => handleTouchStart('right', e)}
            onTouchEnd={(e) => handleTouchEnd('right', e)}
            onMouseDown={() => { pressedKeysRef.current.add('right'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('right'); computeAndSendCommand(); }}
          >
            ►
          </button>
        </div>

      </div>
    </div>
  );
}