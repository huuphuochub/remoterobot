"use client"
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const CONTROL_TOPIC = 'my_robot_123/control'; 
const CAMERA_TOPIC = 'phuoccam/photo'; 

export default function RobotController() {
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState('Đang kết nối...');
  const [activeCommand, setActiveCommand] = useState('stop');
  
  const [isControlMode, setIsControlMode] = useState(false);
  const [isLightOn, setIsLightOn] = useState(false);
  const [isHornOn, setIsHornOn] = useState(false);
  const [cameraFrame, setCameraFrame] = useState(null);

  const pressedKeysRef = useRef(new Set());
  const clientRef = useRef(null);

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
    });

    mqttClient.on('reconnect', () => {
      setIsConnected(false);
      setStatusText('Đang nối lại...');
    });

    mqttClient.on('error', () => {
      setIsConnected(false);
      setStatusText('Lỗi kết nối!');
    });

    mqttClient.on('message', (topic, message) => {
      if (topic === CAMERA_TOPIC) {
        const blob = new Blob([message], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setCameraFrame(url);
      }
    });

    clientRef.current = mqttClient;

    return () => {
      if (mqttClient) mqttClient.end();
    };
  }, []);

  const computeAndSendCommand = useCallback(() => {
    if (!isControlMode) return;

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
      clientRef.current.publish(CONTROL_TOPIC, nextState ? 'mode_control_on' : 'mode_control_off', { qos: 0 });
    }
  };

  const toggleLight = () => {
    const nextState = !isLightOn;
    setIsLightOn(nextState);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(CONTROL_TOPIC, nextState ? 'light_on' : 'light_off', { qos: 0 });
    }
  };

  const toggleHorn = (state) => {
    setIsHornOn(state);
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(CONTROL_TOPIC, state ? 'horn_on' : 'horn_off', { qos: 0 });
    }
  };

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

  const getNavBtnStyle = (key) => {
    const isPressed = pressedKeysRef.current.has(key);
    return {
      backgroundColor: isPressed ? '#2563eb' : '#1e293b',
      color: isPressed ? '#ffffff' : '#94a3b8',
      border: `2px solid ${isPressed ? '#60a5fa' : '#334155'}`,
      borderRadius: '16px',
      fontSize: '22px',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: isPressed ? '0 0 15px rgba(59, 130, 246, 0.6)' : 'none',
      transform: isPressed ? 'scale(0.92)' : 'scale(1)',
      transition: 'all 0.08s ease',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
      width: '65px',
      height: '65px',
      cursor: 'pointer',
    };
  };

  return (
    /* Lớp bọc ngoài ép toàn màn hình và tự động xoay ngang bằng CSS */
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: '#090d16',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
      zIndex: 99999,
    }}>
      {/* Container chính được xoay ngang màn hình tuyệt đối */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '100vh',
        height: '100vw',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        transformOrigin: 'center center',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        boxSizing: 'border-box',
      }}>
        {/* 🟢 CỘT TRÁI: Nút TIẾN / LÙI */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          alignItems: 'center',
          justifyContent: 'center',
          width: '15%',
        }}>
          <button 
            style={getNavBtnStyle('up')}
            onTouchStart={(e) => handleTouchStart('up', e)}
            onTouchEnd={(e) => handleTouchEnd('up', e)}
            onMouseDown={() => { pressedKeysRef.current.add('up'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('up'); computeAndSendCommand(); }}
          >
            ▲
          </button>

          <button 
            style={getNavBtnStyle('down')}
            onTouchStart={(e) => handleTouchStart('down', e)}
            onTouchEnd={(e) => handleTouchEnd('down', e)}
            onMouseDown={() => { pressedKeysRef.current.add('down'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('down'); computeAndSendCommand(); }}
          >
            ▼
          </button>
        </div>

        {/* 🔴 KHU VỰC GIỮA: Màn hình Stream + Các nút Chức năng + Trạng thái */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '100%',
          maxWidth: '65%',
          padding: '0 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '2px' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px' }}>🤖 Ronaldo Bot</span>
            <div style={{
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '10px',
              fontWeight: '600',
              backgroundColor: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: isConnected ? '#34d399' : '#f87171',
              border: `1px solid ${isConnected ? '#059669' : '#dc2626'}`
            }}>
              ● {statusText}
            </div>
          </div>

          <div style={{
            width: '100vw',
            maxWidth: '100%',
            flex: 1,
            maxHeight: 'calc(100vw - 90px)',
            backgroundColor: '#000000',
            borderRadius: '10px',
            border: '2px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
            margin: '4px 0',
          }}>
            {cameraFrame ? (
              <img 
                src={cameraFrame} 
                alt="Camera Stream" 
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center' }}>
                📷 Đang chờ hình ảnh từ Camera...
              </div>
            )}

            <div style={{
              position: 'absolute',
              bottom: '6px',
              left: '6px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              color: activeCommand === 'stop' ? '#ef4444' : '#38bdf8'
            }}>
              Lệnh: <strong>{activeCommand.toUpperCase()}</strong>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
            width: '100%',
            marginBottom: '2px'
          }}>
            <button 
              onClick={toggleControlMode}
              style={{
                padding: '6px 14px',
                borderRadius: '16px',
                border: 'none',
                fontWeight: 'bold',
                fontSize: '11px',
                backgroundColor: isControlMode ? '#059669' : '#334155',
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: isControlMode ? '0 0 10px rgba(16, 185, 129, 0.5)' : 'none',
              }}
            >
              {isControlMode ? '🎮 Đang Điều Khiển' : '⚪ Bật Điều Khiển'}
            </button>

            <button 
              onClick={toggleLight}
              style={{
                padding: '6px 12px',
                borderRadius: '16px',
                border: 'none',
                fontWeight: 'bold',
                fontSize: '11px',
                backgroundColor: isLightOn ? '#eab308' : '#334155',
                color: isLightOn ? '#000000' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              💡 {isLightOn ? 'Tắt Đèn' : 'Bật Đèn'}
            </button>

            <button 
              onTouchStart={() => toggleHorn(true)}
              onTouchEnd={() => toggleHorn(false)}
              onMouseDown={() => toggleHorn(true)}
              onMouseUp={() => toggleHorn(false)}
              style={{
                padding: '6px 12px',
                borderRadius: '16px',
                border: 'none',
                fontWeight: 'bold',
                fontSize: '11px',
                backgroundColor: isHornOn ? '#dc2626' : '#334155',
                color: '#ffffff',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              📢 Còi
            </button>
          </div>
        </div>

        {/* 🔵 CỘT PHẢI: Nút RẼ TRÁI / RẼ PHẢI */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '20px',
          alignItems: 'center',
          justifyContent: 'center',
          width: '15%',
        }}>
          <button 
            style={getNavBtnStyle('left')}
            onTouchStart={(e) => handleTouchStart('left', e)}
            onTouchEnd={(e) => handleTouchEnd('left', e)}
            onMouseDown={() => { pressedKeysRef.current.add('left'); computeAndSendCommand(); }}
            onMouseUp={() => { pressedKeysRef.current.delete('left'); computeAndSendCommand(); }}
          >
            ◄
          </button>

          <button 
            style={getNavBtnStyle('right')}
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