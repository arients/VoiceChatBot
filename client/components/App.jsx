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
    temperature: "0.8",
    microphoneId: "",
    startWithMicDisabled: false,
  });

  const [sessionState, setSessionState] = useState({
    status: "idle",
    muted: false,
  });

  const [microphones, setMicrophones] = useState([]);
  const [isMicLoading, setIsMicLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);

  const sessionEndedRef = useRef(false);
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const audioElement = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const localStreamRef = useRef(null);
  const micStoppedRef = useRef(false);
  const mergerRef = useRef(null); // Holds the merger node that connects the microphone to the analyser

  // Get list of microphones
  const fetchMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      console.warn("MediaDevices API is not supported");
      setIsMicLoading(false);
      return;
    }
    try {
      // Request access and immediately stop the obtained stream
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((device) => device.kind === "audioinput");
      setMicrophones(mics);

      // If the selected microphone is not available, choose the default
      if (mics.length > 0 && !mics.some((mic) => mic.deviceId === config.microphoneId)) {
        setConfig((prev) => ({ ...prev, microphoneId: mics[0].deviceId }));
      }
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Failed to access the microphone");
    } finally {
      setIsMicLoading(false);
    }
  }, [config.microphoneId]);

  // Get microphones on mount
  useEffect(() => {
    fetchMicrophones();
  }, [fetchMicrophones]);

  // Update analyser source by merging mic and incoming audio
  const updateAnalyserSource = useCallback(() => {
    if (!audioContextRef.current || !localStreamRef.current || !audioElement.current) return;
    const audioCtx = audioContextRef.current;
    // Disconnect previous merger if it exists
    if (mergerRef.current) {
      try {
        mergerRef.current.disconnect();
      } catch (e) {
        console.warn("Error disconnecting previous merger:", e);
      }
    }
    const micSource = audioCtx.createMediaStreamSource(localStreamRef.current);
    const aiSource = audioCtx.createMediaElementSource(audioElement.current);
    const merger = audioCtx.createChannelMerger(2);
    micSource.connect(merger, 0, 0);
    aiSource.connect(merger, 0, 1);
    merger.connect(analyserRef.current);
    mergerRef.current = merger;
  }, []);

  // Reconnect audio using the selected (or default) microphone
  const reconnectAudio = useCallback(async () => {
    if (!peerConnection.current) return false;
    try {
      const constraints = config.microphoneId
        ? { audio: { deviceId: { exact: config.microphoneId } } }
        : { audio: true };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newAudioTrack = newStream.getAudioTracks()[0];
      newAudioTrack.enabled = !sessionState.muted;

      const sender = peerConnection.current
        .getSenders()
        .find((s) => s.track?.kind === "audio");
      if (sender) {
        await sender.replaceTrack(newAudioTrack);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      localStreamRef.current = newStream;

      // Update the analyser source with the new stream
      updateAnalyserSource();

      // If the device disconnects during the session, reconnect
      newAudioTrack.onended = async () => {
        console.warn("Selected microphone disconnected, switching to default");
        await fetchMicrophones();
        if (microphones.length > 0) {
          setConfig((prev) => ({ ...prev, microphoneId: microphones[0].deviceId }));
          await reconnectAudio();
        }
      };

      return true;
    } catch (error) {
      console.error("Error reconnecting audio:", error);
      return false;
    }
  }, [config.microphoneId, sessionState.muted, fetchMicrophones, microphones, updateAnalyserSource]);

  // Handle device changes (e.g. Bluetooth headset disconnection)
  useEffect(() => {
    const handleDeviceChange = async () => {
      await fetchMicrophones();
      const currentExists = microphones.some((mic) => mic.deviceId === config.microphoneId);
      if (!currentExists && sessionState.status === "active" && microphones.length > 0) {
        setConfig((prev) => ({ ...prev, microphoneId: microphones[0].deviceId }));
        await reconnectAudio();
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [fetchMicrophones, microphones, config.microphoneId, sessionState.status, reconnectAudio]);

  // Terminate the session
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
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/end");
      } else {
        await fetch("/end", { method: "POST" });
      }
    } catch (err) {
      console.error("Error terminating session:", err);
    } finally {
      sessionEndedRef.current = true;
      setSessionState({ status: "idle", muted: false });
      setView("menu");
      setConnectionState("disconnected");
    }
  }, []);

  // Start session with loading overlay and disable buttons during the process
  const startSession = useCallback(async () => {
    if (loadingSession || loadingPrompt) return;
    setLoadingSession(true);
    try {
      setConnectionState("connecting");
      setError("");

      // Get token
      const tokenResponse = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          voice: config.voice,
          instructions: config.instructions,
          temperature: parseFloat(config.temperature),
        }),
      });
      const tokenData = await tokenResponse.json();
      if (tokenData.error) throw new Error(tokenData.error.message);
      if (!tokenData.client_secret) throw new Error("Missing client_secret");

      sessionEndedRef.current = false;
      const EPHEMERAL_KEY = tokenData.client_secret.value;

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      // Create audio element for incoming audio playback
      audioElement.current = document.createElement("audio");
      audioElement.current.id = "audioPlayback"; // Set id for volume control
      audioElement.current.crossOrigin = "anonymous";
      audioElement.current.autoplay = true;

      // Initialize audio context and analyser
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      // Handle incoming audio
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

      // Get local stream with the selected microphone
      const constraints = config.microphoneId
        ? { audio: { deviceId: { exact: config.microphoneId } } }
        : { audio: true };
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = localStream;

      // If starting with the microphone disabled
      if (config.startWithMicDisabled) {
        localStream.getAudioTracks().forEach((track) => (track.enabled = false));
        setSessionState((prev) => ({ ...prev, muted: true }));
      }

      const audioTrack = localStream.getAudioTracks()[0];
      // If the microphone disconnects during the session, reconnect using the default device
      audioTrack.onended = async () => {
        console.warn("Microphone disconnected during session, switching to default");
        await fetchMicrophones();
        if (microphones.length > 0) {
          setConfig((prev) => ({ ...prev, microphoneId: microphones[0].deviceId }));
          await reconnectAudio();
        }
      };

      // Add audio track to the connection
      pc.addTrack(audioTrack, localStream);

      // Create data channel
      dataChannel.current = pc.createDataChannel("oai-events");

      // Create offer and set SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const apiUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(
        config.model
      )}`;
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

      // Update the analyser source after stream is set
      updateAnalyserSource();

      setSessionState({ status: "active", muted: config.startWithMicDisabled });
      setView("session");
      setConnectionState("connected");
    } catch (err) {
      console.error("Error starting session:", err);
      setError(err.message);
      await terminateSession();
    } finally {
      setLoadingSession(false);
    }
  }, [
    config,
    terminateSession,
    microphones,
    reconnectAudio,
    updateAnalyserSource,
    loadingSession,
    loadingPrompt,
  ]);

  // Handle tab visibility changes: stop audio when hidden and reconnect when visible
  const handleVisibilityChange = useCallback(async () => {
    if (document.hidden) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        micStoppedRef.current = true;
      }
    } else {
      if (micStoppedRef.current && peerConnection.current) {
        await reconnectAudio();
        micStoppedRef.current = false;
      }
    }
  }, [reconnectAudio]);

  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleVisibilityChange]);

  // Update connection state
  useEffect(() => {
    const pc = peerConnection.current;
    if (!pc) return;
    const updateState = () => setConnectionState(pc.connectionState);
    pc.addEventListener("connectionstatechange", updateState);
    return () => pc.removeEventListener("connectionstatechange", updateState);
  }, []);

  // Toggle mute/unmute for the microphone
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setSessionState((prev) => ({ ...prev, muted: !prev.muted }));
    }
  }, []);

  // Global cleanup on page unload
  useEffect(() => {
    const cleanupHandler = () => {
      if (sessionState.status !== "idle") {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
        }
        if (peerConnection.current) {
          peerConnection.current.close();
        }
        navigator.sendBeacon("/end");
      }
    };
    window.addEventListener("beforeunload", cleanupHandler);
    return () => window.removeEventListener("beforeunload", cleanupHandler);
  }, [sessionState.status]);

  // Handle prompt generation with loading state
  const handleCreatePrompt = async () => {
    if (loadingSession || loadingPrompt) return;
    setLoadingPrompt(true);
    try {
      const response = await fetch("/prompt");
      const data = await response.json();
      setConfig((prev) => ({ ...prev, instructions: data.instruction }));
      // Also add the generated instruction to chat messages as an AI message
      setChatMessages((prev) => [...prev, { sender: "ai", text: data.instruction }]);
    } catch (err) {
      console.error("Error fetching prompt:", err);
    } finally {
      setLoadingPrompt(false);
    }
  };

  // Callback to handle microphone change from RealTimeSession settings modal
  const handleMicrophoneChange = (newMicId) => {
    setConfig((prev) => ({ ...prev, microphoneId: newMicId }));
  };

  return (
    <div className="app-container min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd] relative">
      {error && (
        <div className="api-error fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded z-50">
          {error}
          <button onClick={() => setError("")} className="ml-4 text-white font-bold">
            ×
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
          onCreatePrompt={handleCreatePrompt}
          onModelCreate={startSession}
          isMicLoading={isMicLoading}
          microphones={microphones}
          loadingSession={loadingSession}
          loadingPrompt={loadingPrompt}
        />
      )}

      {view === "session" && (
        <RealTimeSession
          sessionState={sessionState}
          toggleMute={toggleMute}
          terminateSession={terminateSession}
          audioContext={audioContextRef.current}
          analyser={analyserRef.current}
          microphones={microphones}
          onMicrophoneChange={handleMicrophoneChange}
          chatMessages={chatMessages}
        />
      )}

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
