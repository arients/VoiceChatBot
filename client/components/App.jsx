import { useState, useRef, useEffect, useCallback } from "react";
import ModelSelection from "./ModelSelection";
import RealTimeConfiguration from "./RealTimeConfiguration";
import RealTimeSession from "./RealTimeSession";

export default function App() {
  const [view, setView] = useState("menu");
  const [error, setError] = useState("");
  const [config, setConfig] = useState({
    voice: "alloy",
    instructions: "",
    microphoneId: "",
    startWithMicDisabled: false,
  });
  const [sessionState, setSessionState] = useState({
    status: "idle",
    muted: false,
  });
  const [microphones, setMicrophones] = useState([]);
  const [isMicLoading, setIsMicLoading] = useState(true);

  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const sessionEndedRef = useRef(false);
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const audioElement = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const localStreamRef = useRef(null);
  const localAudioSenderRef = useRef(null);
  const micStoppedRef = useRef(false);

  // Получение списка микрофонов с обработкой iOS
  const getMicrophones = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        throw new Error("MediaDevices API not supported");
      }

      if (isiOS) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(track => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices
        .filter(d => d.kind === "audioinput")
        .map(d => ({ ...d, label: d.label || `Microphone ${devices.indexOf(d) + 1}` }));

      setMicrophones(audioDevices);
      if (audioDevices.length > 0 && !config.microphoneId) {
        setConfig(prev => ({ ...prev, microphoneId: audioDevices[0].deviceId }));
      }
    } catch (error) {
      console.error("Microphone access error:", error);
      setError("Microphone access required");
    } finally {
      setIsMicLoading(false);
    }
  }, [config.microphoneId, isiOS]);

  // Обработчик изменения видимости страницы
  const handleVisibilityChange = useCallback(() => {
    if (document.hidden || document.visibilityState === "hidden") {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
        localStreamRef.current = null;
        micStoppedRef.current = true;
      }
    }
  }, []);

  // Обработчик изменения устройств
  const handleDeviceChange = useCallback(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const audioDevices = devices.filter(d => d.kind === "audioinput");
      setMicrophones(audioDevices);
    });
  }, []);

  // Инициализация микрофонов и событий
  useEffect(() => {
    getMicrophones();

    const events = ["visibilitychange", "pagehide", "blur"];
    events.forEach(e => window.addEventListener(e, handleVisibilityChange));
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      events.forEach(e => window.removeEventListener(e, handleVisibilityChange));
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      localStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [getMicrophones, handleDeviceChange, handleVisibilityChange]);

  const startSession = useCallback(async () => {
    try {
      console.log("Starting session with config:", config);
      const tokenResponse = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: config.voice,
          instructions: config.instructions,
        }),
      });

      const tokenData = await tokenResponse.json();
      if (!tokenData.client_secret) throw new Error("Invalid server response");

      sessionEndedRef.current = false;
      const EPHEMERAL_KEY = tokenData.client_secret.value;

      // Инициализация WebRTC
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      // Создание аудио элемента
      audioElement.current = document.createElement("audio");
      audioElement.current.crossOrigin = "anonymous";
      audioElement.current.autoplay = true;
      pc.ontrack = e => e.streams[0] && (audioElement.current.srcObject = e.streams[0]);

      // Получение микрофона
      const constraints = config.microphoneId
        ? { deviceId: { exact: config.microphoneId } }
        : true;
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      localStreamRef.current = localStream;

      if (config.startWithMicDisabled) {
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        setSessionState(prev => ({ ...prev, muted: true }));
      }

      // Добавление трека в соединение
      const audioTrack = localStream.getAudioTracks()[0];
      const sender = pc.addTrack(audioTrack, localStream);
      localAudioSenderRef.current = sender;

      // Создание data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;

      // Установка соединения
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      // Инициализация аудио анализатора
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      // Настройка аудио микшера
      const micSource = audioContextRef.current.createMediaStreamSource(localStream);
      const aiSource = audioContextRef.current.createMediaElementSource(audioElement.current);
      const merger = audioContextRef.current.createChannelMerger(2);
      micSource.connect(merger, 0, 0);
      aiSource.connect(merger, 0, 1);
      merger.connect(analyserRef.current);

      setSessionState(prev => ({ ...prev, status: "session active..." }));
      setView("session");
    } catch (err) {
      setError(`Session start failed: ${err.message}`);
      terminateSession();
    }
  }, [config]);

  const terminateSession = useCallback(async () => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;

    try {
      if (sessionState.status !== "idle") await fetch("/end", { method: "POST" });

      peerConnection.current?.close();
      dataChannel.current?.close();
      audioContextRef.current?.close();
      audioElement.current?.pause();
      localStreamRef.current?.getTracks().forEach(track => track.stop());

      peerConnection.current = null;
      dataChannel.current = null;
      audioContextRef.current = null;
      audioElement.current = null;
      localStreamRef.current = null;
    } catch (err) {
      console.error("Session termination error:", err);
    }

    setSessionState({ status: "idle", muted: false });
    setView("menu");
  }, [sessionState.status]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const newState = !sessionState.muted;
      localStreamRef.current.getAudioTracks().forEach(track => track.enabled = newState);
      setSessionState(prev => ({ ...prev, muted: newState }));
    }
  }, [sessionState.muted]);

  return (
    <div className="app-container min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd]">
      {error && (
        <div className="api-error fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded z-50">
          {error}
          <button onClick={() => setError("")} className="ml-4 text-white font-bold">
            ✕
          </button>
        </div>
      )}

      {view === "menu" && <ModelSelection onSelectRealTime={() => setView("configuration")} />}

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
              console.error("Prompt generation failed:", err);
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

      {view === "configuration" && (
        <button
          onClick={() => setView("menu")}
          className="fixed top-4 left-4 p-2 bg-gray-200 hover:bg-gray-300 rounded-full"
          title="Back to main"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
      )}
    </div>
  );
}