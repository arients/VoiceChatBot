import { useState, useRef, useEffect } from "react";
import ModelSelection from "./ModelSelection";
import RealTimeConfiguration from "./RealTimeConfiguration";
import RealTimeSession from "./RealTimeSession";

export default function App() {
  // Состояние текущего представления: 'menu' | 'configuration' | 'session'
  const [view, setView] = useState("menu");

  // Состояние для отображения ошибок (например, лимит сессий)
  const [error, setError] = useState("");

  // Конфигурация Real-Time модели
  const [config, setConfig] = useState({
    voice: "alloy",
    instructions: "",
    microphoneId: "",
    startWithMicDisabled: false,
    model: "gpt-4o-realtime-preview-2024-12-17", // добавляем model для использования в запросе
  });

  // Состояние сессии (например, статус работы и mute)
  const [sessionState, setSessionState] = useState({
    status: "idle", // Возможные значения: "idle", "session active...", и т.д.
    muted: false,
  });

  // Флаг, что сессия уже завершена (чтобы не отправлять /end повторно)
  const sessionEndedRef = useRef(false);

  // Ссылки для хранения объектов соединения и аудиоэлемента
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const audioElement = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);

  // Ref для хранения локального потока микрофона
  const localStreamRef = useRef(null);
  // Ref для хранения отправителя аудио-трека в RTCPeerConnection
  const localAudioSenderRef = useRef(null);
  // Флаг, что микрофон был остановлен при уходе со страницы
  const micStoppedRef = useRef(false);

  const [microphones, setMicrophones] = useState([]);
  const [isMicLoading, setIsMicLoading] = useState(true);

  useEffect(() => {
    const getMicrophones = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("MediaDevices API не поддерживается в этом браузере.");
        setIsMicLoading(false);
        return;
      }

      try {
        // Запрос разрешения для получения меток устройств
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((device) => device.kind === "audioinput");

        setMicrophones(mics);

        if (mics.length > 0 && !config.microphoneId) {
          setConfig((prev) => ({ ...prev, microphoneId: mics[0].deviceId }));
        }
      } catch (err) {
        console.error("Ошибка доступа к микрофону:", err);
      } finally {
        setIsMicLoading(false);
      }
    };

    getMicrophones();
  }, [setConfig, config.microphoneId]);

  async function startSession() {
    console.log("Starting Real-Time session with configuration:", config);
    try {
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
      if (tokenData.error) {
        throw new Error("Error creating session: " + JSON.stringify(tokenData.error));
      }
      if (!tokenData.client_secret) {
        throw new Error("Client Secret missing in response: " + JSON.stringify(tokenData));
      }

      // Сброс флага завершения сессии при старте новой сессии
      sessionEndedRef.current = false;

      const EPHEMERAL_KEY = tokenData.client_secret.value;
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      audioElement.current = document.createElement("audio");
      audioElement.current.crossOrigin = "anonymous";
      audioElement.current.autoplay = true;

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          audioElement.current.srcObject = event.streams[0];
        }
      };

      const constraints = {
        audio: config.microphoneId
          ? { deviceId: { exact: config.microphoneId } }
          : true,
      };
      // Получаем микрофон один раз и сохраняем поток
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = localStream;

      if (config.startWithMicDisabled) {
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
        setSessionState((prev) => ({ ...prev, muted: true }));
      }

      // Добавляем аудио-трек в соединение и сохраняем отправителя
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const sender = pc.addTrack(audioTracks[0], localStream);
        localAudioSenderRef.current = sender;
      }

      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

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
      const answer = { type: "answer", sdp: answerSdp };
      await pc.setRemoteDescription(answer);

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      const mergeAudio = async () => {
        const audioCtx = audioContextRef.current;
        if (!audioCtx) return;

        // Создаем источники для микрофона и аудио элемента
        const micSource = audioCtx.createMediaStreamSource(localStreamRef.current);
        const aiSource = audioCtx.createMediaElementSource(audioElement.current);

        // Объединяем аудио через ChannelMergerNode
        const merger = audioCtx.createChannelMerger(2);
        micSource.connect(merger, 0, 0);
        aiSource.connect(merger, 0, 1);

        // Подключаем объединённый сигнал к анализатору
        merger.connect(analyserRef.current);
      };

      await mergeAudio();

      setSessionState((prev) => ({ ...prev, status: "session active..." }));
      setView("session");
    } catch (err) {
      setError("Failed to create session: " + err.message);
    }
  }

  async function terminateSession() {
    // Если сессия уже завершена, повторный вызов не выполняем
    if (sessionEndedRef.current) return;

    try {
      if (sessionState.status !== "idle") {
        await fetch("/end", { method: "POST" });
      }
      sessionEndedRef.current = true; // Фиксируем, что сессия завершена
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
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    } catch (err) {
      setError("Error ending session: " + err.message);
    }
    setSessionState({ status: "idle", muted: false });
    setView("menu");
  }

  function toggleMute() {
    if (peerConnection.current && localStreamRef.current) {
      const senders = peerConnection.current.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          sender.track.enabled = !sender.track.enabled;
        }
      });
    }
    setSessionState((prev) => ({ ...prev, muted: !prev.muted }));
  }

  // Обработка событий для остановки/возобновления микрофона при потере/возвращении фокуса
  useEffect(() => {
    async function pauseMicrophone() {
      if (localStreamRef.current && !micStoppedRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        if (localAudioSenderRef.current) {
          await localAudioSenderRef.current.replaceTrack(null);
        }
        micStoppedRef.current = true;
        console.log("Микрофон остановлен (страница не активна).");
      }
    }

    async function resumeMicrophone() {
      if (micStoppedRef.current) {
        let newStream;
        const constraints = config.microphoneId
          ? { audio: { deviceId: { exact: config.microphoneId } } }
          : { audio: true };
        try {
          newStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          console.warn("Выбранный микрофон недоступен, используем дефолтный", err);
          newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const defaultTrack = newStream.getAudioTracks()[0];
          const settings = defaultTrack.getSettings();
          setConfig((prev) => ({ ...prev, microphoneId: settings.deviceId || "" }));
        }
        const newAudioTrack = newStream.getAudioTracks()[0];
        if (sessionState.muted) {
          newAudioTrack.enabled = false;
        }
        if (localAudioSenderRef.current) {
          await localAudioSenderRef.current.replaceTrack(newAudioTrack);
        }
        localStreamRef.current = newStream;
        micStoppedRef.current = false;
        console.log("Микрофон возобновлён (страница активна).");
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        pauseMicrophone();
      } else {
        resumeMicrophone();
      }
    }

    window.addEventListener("blur", pauseMicrophone);
    window.addEventListener("focus", resumeMicrophone);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", pauseMicrophone);
    window.addEventListener("pageshow", resumeMicrophone);

    return () => {
      window.removeEventListener("blur", pauseMicrophone);
      window.removeEventListener("focus", resumeMicrophone);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", pauseMicrophone);
      window.removeEventListener("pageshow", resumeMicrophone);
    };
  }, [config.microphoneId, sessionState.muted]);

  useEffect(() => {
    function handleBeforeUnload() {
      if (sessionState.status !== "idle" && !sessionEndedRef.current) {
        navigator.sendBeacon("/end");
        sessionEndedRef.current = true;
        if (peerConnection.current) {
          peerConnection.current.close();
          peerConnection.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (audioElement.current) {
          audioElement.current.pause();
          audioElement.current = null;
        }
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
        }
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionState.status]);

  return (
    <div className="app-container min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd]">
      {/* Уведомление об ошибке */}
      {error && (
        <div className="api-error fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded z-50">
          {error}
          <button onClick={() => setError("")} className="ml-4 text-white font-bold">
            X
          </button>
        </div>
      )}

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
              setConfig((prev) => ({ ...prev, instructions: data.instruction }));
              console.log("Received prompt:", data.instruction);
            } catch (err) {
              console.error("Failed to fetch prompt:", err);
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
