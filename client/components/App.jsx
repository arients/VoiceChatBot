import { useState, useRef, useEffect, useCallback } from "react";
import ModelSelection from "./ModelSelection";
import RealTimeConfiguration from "./RealTimeConfiguration";
import RealTimeSession from "./RealTimeSession";

export default function App() {
  const [view, setView] = useState("menu");
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState("disconnected");

  const [config, setConfig] = useState({
    model: "gpt-4o-realtime-preview-2024-12-17",
    voice: "alloy",
    instructions: "",
    microphoneId: "",
    startWithMicDisabled: false,
  });

  const [sessionState, setSessionState] = useState({
    status: "idle",
    muted: false,
  });

  const sessionEndedRef = useRef(false);
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const audioElement = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const localStreamRef = useRef(null);
  const micStoppedRef = useRef(false);

  const [microphones, setMicrophones] = useState([]);
  const [isMicLoading, setIsMicLoading] = useState(true);

  // Получение списка микрофонов
  useEffect(() => {
    const getMicrophones = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        console.warn("MediaDevices API не поддерживается");
        setIsMicLoading(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(device => device.kind === "audioinput");
        setMicrophones(mics);

        if (mics.length > 0 && !config.microphoneId) {
          setConfig(prev => ({ ...prev, microphoneId: mics[0].deviceId }));
        }
      } catch (err) {
        console.error("Ошибка доступа к микрофону:", err);
        setError("Не удалось получить доступ к микрофону");
      } finally {
        setIsMicLoading(false);
      }
    };

    getMicrophones();
  }, [config.microphoneId]);

  // Обработчик изменения устройства
  useEffect(() => {
    const handleDeviceChange = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(device => device.kind === "audioinput");
        setMicrophones(mics);

        const currentMicExists = mics.some(mic => mic.deviceId === config.microphoneId);
        if (!currentMicExists && mics.length > 0) {
          setConfig(prev => ({ ...prev, microphoneId: mics[0].deviceId }));
        }
      } catch (err) {
        console.error("Ошибка обновления устройств:", err);
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [config.microphoneId]);

  // Завершение сессии
  const terminateSession = useCallback(async () => {
    if (sessionEndedRef.current) return;

    try {
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (dataChannel.current) {
        dataChannel.current.close();
        dataChannel.current = null;
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (audioElement.current) {
        audioElement.current.pause();
        audioElement.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      if (navigator.sendBeacon) {
        navigator.sendBeacon("/end");
      } else {
        await fetch("/end", { method: "POST" });
      }
    } catch (err) {
      console.error("Ошибка завершения сессии:", err);
    } finally {
      sessionEndedRef.current = true;
      setSessionState({ status: "idle", muted: false });
      setView("menu");
      setConnectionState("disconnected");
    }
  }, []);

  // Запуск сессии
  const startSession = useCallback(async () => {
    console.log("Запуск сессии с конфигурацией:", config);
    try {
      setConnectionState("connecting");
      setError("");

      const tokenResponse = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          voice: config.voice,
          instructions: config.instructions,
        }),
      });

      const tokenData = await tokenResponse.json();
      if (tokenData.error) throw new Error(tokenData.error.message);
      if (!tokenData.client_secret) throw new Error("Отсутствует client_secret");

      sessionEndedRef.current = false;
      const EPHEMERAL_KEY = tokenData.client_secret.value;

      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      audioElement.current = document.createElement("audio");
      audioElement.current.crossOrigin = "anonymous";
      audioElement.current.autoplay = true;

      // Инициализация аудио контекста
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      pc.ontrack = (event) => {
        if (event.streams?.[0]) {
          audioElement.current.srcObject = event.streams[0];

          if (!audioContextRef.current._aiSource) {
            const aiSource = audioContextRef.current.createMediaStreamSource(event.streams[0]);
            aiSource.connect(analyserRef.current);
            audioContextRef.current._aiSource = aiSource;
          }
        }
      };

      // Получение локального потока
      const constraints = {
        audio: config.microphoneId
          ? { deviceId: { exact: config.microphoneId } }
          : true
      };

      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = localStream;

      if (config.startWithMicDisabled) {
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        setSessionState(prev => ({ ...prev, muted: true }));
      }

      // Добавление трека в соединение
      const audioTrack = localStream.getAudioTracks()[0];
      const sender = pc.addTrack(audioTrack, localStream);

      // Создание data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;

      // Создание offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Установка соединения с OpenAI
      const apiUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`;
      const sdpResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // Обновление состояния
      setSessionState(prev => ({ ...prev, status: "active" }));
      setView("session");
      setConnectionState("connected");

    } catch (err) {
      console.error("Ошибка запуска сессии:", err);
      setError(err.message);
      await terminateSession();
    }
  }, [config, terminateSession]);

  // Обработчик видимости вкладки
  const handleVisibilityChange = useCallback(async () => {
    if (document.hidden) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        micStoppedRef.current = true;
      }
    } else {
      if (micStoppedRef.current && peerConnection.current) {
        try {
          if (["disconnected", "failed"].includes(connectionState)) {
            return;
          }

          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: config.microphoneId
              ? { deviceId: { exact: config.microphoneId } }
              : true
          });

          const newAudioTrack = newStream.getAudioTracks()[0];
          newAudioTrack.enabled = !sessionState.muted;

          const sender = peerConnection.current.getSenders()
            .find(s => s.track?.kind === "audio");

          if (sender) await sender.replaceTrack(newAudioTrack);

          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
          }
          localStreamRef.current = newStream;
          micStoppedRef.current = false;
        } catch (err) {
          console.error("Ошибка переподключения:", err);
          await terminateSession();
          await startSession();
        }
      }
    }
  }, [config.microphoneId, sessionState.muted, connectionState, terminateSession, startSession]);

  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleVisibilityChange]);

  // Отслеживание состояния соединения
  useEffect(() => {
    const pc = peerConnection.current;
    if (!pc) return;

    const updateState = () => setConnectionState(pc.connectionState);
    pc.addEventListener("connectionstatechange", updateState);
    return () => pc.removeEventListener("connectionstatechange", updateState);
  }, []);

  // Функция переподключения аудио
  const reconnectAudio = useCallback(async () => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: config.microphoneId
          ? { deviceId: { exact: config.microphoneId } }
          : true
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      newAudioTrack.enabled = !sessionState.muted;

      const sender = peerConnection.current
        .getSenders()
        .find(s => s.track?.kind === "audio");

      if (sender) {
        await sender.replaceTrack(newAudioTrack);
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
        }
        localStreamRef.current = newStream;
        return true;
      }
    } catch (error) {
      console.error("Ошибка переподключения аудио:", error);
      return false;
    }
  }, [config.microphoneId, sessionState.muted]);

  // Обработчик очистки
  const cleanupHandler = useCallback(() => {
    if (sessionState.status !== "idle") {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      navigator.sendBeacon("/end");
    }
  }, [sessionState.status]);

  useEffect(() => {
    window.addEventListener("beforeunload", cleanupHandler);
    return () => window.removeEventListener("beforeunload", cleanupHandler);
  }, [cleanupHandler]);

  // Переключение микрофона
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setSessionState(prev => ({ ...prev, muted: !prev.muted }));
    }
  }, []);

  return (
    <div className="app-container min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd]">
      {/* Отображение ошибок */}
      {error && (
        <div className="api-error fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded z-50">
          {error}
          <button
            onClick={() => setError("")}
            className="ml-4 text-white font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Маршрутизация представлений */}
      {view === "menu" && (
        <ModelSelection onSelectRealTime={() => setView("configuration")} />
      )}

      {view === "configuration" && (
        <RealTimeConfiguration
          config={config}
          setConfig={setConfig}
          onCreatePrompt={async () => {
            try {
              const response = await fetch("/prompt");
              const data = await response.json();
              setConfig(prev => ({ ...prev, instructions: data.instruction }));
            } catch (err) {
              console.error("Ошибка получения подсказки:", err);
            }
          }}
          onModelCreate={startSession}
          isMicLoading={isMicLoading}
          microphones={microphones}
        />
      )}

      {view === "session" && (
        <RealTimeSession
          sessionState={sessionState}
          toggleMute={toggleMute}
          terminateSession={terminateSession}
          audioContext={audioContextRef.current}
          analyser={analyserRef.current}
        />
      )}

      {/* Кнопка возврата */}
      {view === "configuration" && (
        <button
          onClick={() => setView("menu")}
          className="fixed top-4 left-4 p-2 bg-gray-200 hover:bg-gray-300 rounded-full"
          title="Back to menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
      )}
    </div>
  );
}