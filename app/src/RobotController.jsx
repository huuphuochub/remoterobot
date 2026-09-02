"use client"
import React, { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_TOPIC = 'my_robot_123/control'; 
export default function RobotController() {
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState('Đang kết nối...');
  const [activeCommand, setActiveCommand] = useState('stop');

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
    });

    mqttClient.on('reconnect', () => {
      setIsConnected(false);
      setStatusText('Đang nối lại...');
    });

    mqttClient.on('error', () => {
      setIsConnected(false);
      setStatusText('Lỗi kết nối!');
    });

    clientRef.current = mqttClient;

    return () => {
      if (mqttClient) mqttClient.end();
    };
  }, []);

  const computeAndSendCommand = useCallback(() => {
    const keys = pressedKeysRef.current;
    let newCmd = 'stop';

    const hasUp = keys.has('up');
    const hasDown = keys.has('down');
    const hasLeft = keys.has('left');
    const hasRight = keys.has('right');

    if (hasUp && hasLeft) {
      newCmd = 'forward_left';
    } else if (hasUp && hasRight) {
      newCmd = 'forward_right';
    } else if (hasDown && hasLeft) {
      newCmd = 'backward_left';
    } else if (hasDown && hasRight) {
      newCmd = 'backward_right';
    } 
    else if (hasUp) {
      newCmd = 'forward';
    } else if (hasDown) {
      newCmd = 'backward';
    } else if (hasLeft) {
      newCmd = 'turn_left';
    } else if (hasRight) {
      newCmd = 'turn_right';
    } else {
      newCmd = 'stop';
    }

    setActiveCommand(newCmd);

    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(MQTT_TOPIC, newCmd, { qos: 0 });
    }
  }, []);

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

  const getBtnStyle = (key) => {
    const isPressed = pressedKeysRef.current.has(key);

    return {
      backgroundColor: isPressed ? '#2563eb' : '#1e293b',
      color: isPressed ? '#ffffff' : '#94a3b8',
      border: `2px solid ${isPressed ? '#60a5fa' : '#334155'}`,
      borderRadius: '24px',
      fontSize: '24px',
      fontWeight: 'bold',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: isPressed ? '0 0 20px rgba(59, 130, 246, 0.5)' : 'none',
      transform: isPressed ? 'scale(0.92)' : 'scale(1)',
      transition: 'all 0.08s ease',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
    };
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: '#0f172a',
      color: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '24px 16px 36px 16px',
      boxSizing: 'border-box',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>🤖 robot Ronaldo </h2>
        <div style={{
          display: 'inline-block',
          padding: '4px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: '600',
          backgroundColor: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: isConnected ? '#34d399' : '#f87171',
          border: `1px solid ${isConnected ? '#059669' : '#dc2626'}`
        }}>
          ● {statusText}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gridTemplateAreas: `
          ".  up    ."
          "left . right"
          ". down   ."
        `,
        gap: '16px',
        width: '100%',
        maxWidth: '300px',
        height: '300px',
        margin: '0 auto',
      }}>
        <button 
          style={{ ...getBtnStyle('up'), gridArea: 'up' }}
          onTouchStart={(e) => handleTouchStart('up', e)}
          onTouchEnd={(e) => handleTouchEnd('up', e)}
          onMouseDown={() => { pressedKeysRef.current.add('up'); computeAndSendCommand(); }}
          onMouseUp={() => { pressedKeysRef.current.delete('up'); computeAndSendCommand(); }}
        >
          ▲
        </button>

        <button 
          style={{ ...getBtnStyle('left'), gridArea: 'left' }}
          onTouchStart={(e) => handleTouchStart('left', e)}
          onTouchEnd={(e) => handleTouchEnd('left', e)}
          onMouseDown={() => { pressedKeysRef.current.add('left'); computeAndSendCommand(); }}
          onMouseUp={() => { pressedKeysRef.current.delete('left'); computeAndSendCommand(); }}
        >
          ◄
        </button>

        <button 
          style={{ ...getBtnStyle('right'), gridArea: 'right' }}
          onTouchStart={(e) => handleTouchStart('right', e)}
          onTouchEnd={(e) => handleTouchEnd('right', e)}
          onMouseDown={() => { pressedKeysRef.current.add('right'); computeAndSendCommand(); }}
          onMouseUp={() => { pressedKeysRef.current.delete('right'); computeAndSendCommand(); }}
        >
          ►
        </button>

        <button 
          style={{ ...getBtnStyle('down'), gridArea: 'down' }}
          onTouchStart={(e) => handleTouchStart('down', e)}
          onTouchEnd={(e) => handleTouchEnd('down', e)}
          onMouseDown={() => { pressedKeysRef.current.add('down'); computeAndSendCommand(); }}
          onMouseUp={() => { pressedKeysRef.current.delete('down'); computeAndSendCommand(); }}
        >
          ▼
        </button>
      </div>

      <div style={{ textAlign: 'center', fontSize: '15px' }}>
        Lệnh hiện tại: <strong style={{ color: activeCommand === 'stop' ? '#ef4444' : '#38bdf8', fontSize: '18px' }}>
          {activeCommand.toUpperCase()}
        </strong>
      </div>
    </div>
  );
}