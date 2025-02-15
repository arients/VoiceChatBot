import { useState, useRef, useEffect, useCallback } from "react";
import ModelSelection from "./ModelSelection";
import RealTimeConfiguration from "./RealTimeConfiguration";
import RealTimeSession from "./RealTimeSession";

export default function App() {
  // View states: 'menu' | 'configuration' | 'session'
  const [view, setView] = useState("menu");
  const [error, setError] = useState("");

  // Configuration state
  const [config, setConfig] = useState({
    model: "gpt-4o-realtime-preview-2024-12-17",
    voice: "alloy",
    instructions: "",
    microphoneId: "",
    startWithMicDisabled: false,
  });

  // Session state
  const [sessionState, setSessionState] = useState({
    status: "idle", // Possible values: "idle", "session active..."
    muted: false,
  });

  // Refs for WebRTC objects and media elements
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const audioElement = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const localStreamRef = useRef(null);
  const localAudioSenderRef = useRef(null);
  const sessionEndedRef = useRef(false);
  const micStoppedRef = useRef(false);

  // Microphone list and loading state
  const [microphones, setMicrophones] = useState([]);
  const [isMicLoading, setIsMicLoading] = useState(true);

  // Fetch available microphones and handle device changes
  useEffect(() => {
    const enumerateDevices = async () => {
      try {
        // Request temporary stream to get permission and device labels
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === "audioinput");
        setMicrophones(audioInputs);

        // Set default mic if not set
        if (audioInputs.length > 0 && !config.microphoneId) {
          setConfig(prev => ({ ...prev, microphoneId: audioInputs[0].deviceId }));
        }
      } catch (err) {
        console.error("Microphone access error:", err);
        setError("Microphone access required for real-time sessions");
      } finally {
        setIsMicLoading(false);
      }
    };

    const handleDeviceChange = () => {
      enumerateDevices();
      validateCurrentMicrophone();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    enumerateDevices();

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, []);

  // Validate current microphone exists in available devices
  const validateCurrentMicrophone = useCallback(() => {
    if (microphones.length > 0 && !microphones.some(m => m.deviceId === config.microphoneId)) {
      setConfig(prev => ({
        ...prev,
        microphoneId: microphones[0]?.deviceId || ''
      }));
    }
  }, [microphones, config.microphoneId]);

  // Replace current microphone track with new device
  const replaceMicrophoneTrack = useCallback(async (newDeviceId) => {
    if (!peerConnection.current || !localAudioSenderRef.current) return;

    try {
      // Stop and clean up previous track
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.removeEventListener('ended', handleTrackEnded);
          track.stop();
        });
      }

      // Get new track
      const constraints = { audio: { deviceId: { exact: newDeviceId } } };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getAudioTracks()[0];

      // Replace track in connection
      await localAudioSenderRef.current.replaceTrack(newTrack);
      newTrack.addEventListener('ended', handleTrackEnded);

      // Update references and mute state
      localStreamRef.current = newStream;
      newTrack.enabled = !sessionState.muted;

    } catch (error) {
      console.error('Microphone switch failed:', error);
      setError("Failed to switch microphone - using default");
      // Fallback to default microphone
      const defaultMic = microphones[0]?.deviceId;
      if (defaultMic) {
        setConfig(prev => ({ ...prev, microphoneId: defaultMic }));
      }
    }
  }, [sessionState.muted, microphones]);

  // Handle track termination (e.g., microphone unplugged)
  const handleTrackEnded = useCallback(() => {
    if (microphones.length === 0) return;

    // Find first available alternative microphone
    const fallbackMic = microphones.find(m => m.deviceId !== config.microphoneId)?.deviceId;
    if (fallbackMic) {
      setConfig(prev => ({ ...prev, microphoneId: fallbackMic }));
    } else {
      setError("No available microphones - session terminated");
      terminateSession();
    }
  }, [microphones, config.microphoneId, terminateSession]);

  // Update microphone when config changes
  useEffect(() => {
    if (view === 'session' && peerConnection.current) {
      replaceMicrophoneTrack(config.microphoneId);
    }
  }, [config.microphoneId, view, replaceMicrophoneTrack]);

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Pause media when tab loses focus
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
          micStoppedRef.current = true;
        }
      } else {
        // Resume media when tab regains focus
        if (micStoppedRef.current && view === 'session') {
          try {
            await replaceMicrophoneTrack(config.microphoneId);
            micStoppedRef.current = false;
          } catch (err) {
            setError("Microphone access lost - please restart session");
            terminateSession();
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [view, config.microphoneId, replaceMicrophoneTrack, terminateSession]);

  // Start real-time session
  const startSession = useCallback(async () => {
    try {
      // Request session token from backend
      const tokenResponse = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          voice: config.voice,
          instructions: config.instructions,
        }),
      });

      // Handle token response
      const tokenData = await tokenResponse.json();
      if (!tokenData.client_secret) {
        throw new Error("Missing client secret in response");
      }

      // Initialize WebRTC connection
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;
      sessionEndedRef.current = false;

      // Setup audio elements and processing
      audioElement.current = new Audio();
      audioElement.current.autoplay = true;

      // Create audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
      }

      // Handle incoming audio tracks
      pc.ontrack = (event) => {
        if (event.streams[0]) {
          audioElement.current.srcObject = event.streams[0];
          // Connect audio processing
          const source = audioContextRef.current.createMediaStreamSource(event.streams[0]);
          source.connect(analyserRef.current);
        }
      };

      // Get user microphone
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: config.microphoneId ?
          { deviceId: { exact: config.microphoneId } } :
          true
      });
      localStreamRef.current = localStream;

      // Add microphone track to connection
      const audioTrack = localStream.getAudioTracks()[0];
      audioTrack.addEventListener('ended', handleTrackEnded);
      const sender = pc.addTrack(audioTrack, localStream);
      localAudioSenderRef.current = sender;

      // Configure initial mute state
      if (config.startWithMicDisabled) {
        audioTrack.enabled = false;
        setSessionState(prev => ({ ...prev, muted: true }));
      }

      // Create data channel for session events
      dataChannel.current = pc.createDataChannel("session-events");

      // Establish WebRTC connection
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to OpenAI endpoint
      const response = await fetch(`https://api.openai.com/v1/realtime?model=${config.model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.client_secret.value}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });

      // Complete connection setup
      const answer = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      // Update UI state
      setSessionState({ status: "session active...", muted: config.startWithMicDisabled });
      setView("session");

    } catch (err) {
      setError(`Session start failed: ${err.message}`);
      terminateSession();
    }
  }, [config, handleTrackEnded, terminateSession]);

  // Terminate session cleanup
  const terminateSession = useCallback(async () => {
    if (sessionEndedRef.current) return;

    try {
      // Send session end notification
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/end");
      } else {
        await fetch("/end", { method: "POST" });
      }

      // Close WebRTC connections
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }

      // Clean up media resources
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      sessionEndedRef.current = true;
      setSessionState({ status: "idle", muted: false });
      setView("menu");

    } catch (err) {
      setError("Session termination error: " + err.message);
    }
  }, []);

  // Toggle microphone mute state
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getAudioTracks();
      tracks.forEach(track => track.enabled = !track.enabled);
      setSessionState(prev => ({ ...prev, muted: !prev.muted }));
    }
  }, []);

  // Handle window/tab closure
  useEffect(() => {
    const cleanup = () => {
      if (!sessionEndedRef.current) {
        terminateSession();
      }
    };

    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, [terminateSession]);

  return (
    <div className="app-container min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd]">
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError("")} className="dismiss-btn">
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
          microphones={microphones}
          isMicLoading={isMicLoading}
          onStartSession={startSession}
        />
      )}

      {view === "session" && (
        <RealTimeSession
          sessionState={sessionState}
          toggleMute={toggleMute}
          terminateSession={terminateSession}
          analyser={analyserRef.current}
        />
      )}
    </div>
  );
}