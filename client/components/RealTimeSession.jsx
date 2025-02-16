import React, { useEffect, useState } from "react";
import CircleAnimation from "./CircleAnimation";

export default function RealTimeSession({
                                          sessionState,
                                          toggleMute,
                                          terminateSession,
                                          audioContext,
                                          analyser,
                                          microphones,
                                          onMicrophoneChange,
                                          chatMessages,
                                        }) {
  const [timeLeft, setTimeLeft] = useState(360);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [volume, setVolume] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  // Отслеживание изменения размера окна
  useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Таймер
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (timeLeft === 0) {
      terminateSession();
    }
  }, [timeLeft, terminateSession]);

  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(
    timeLeft % 60
  ).padStart(2, "0")}`;

  // Активация аудиоконтекста
  useEffect(() => {
    const resumeAudio = () => {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }
    };
    document.addEventListener("click", resumeAudio);
    document.addEventListener("touchstart", resumeAudio);
    return () => {
      document.removeEventListener("click", resumeAudio);
      document.removeEventListener("touchstart", resumeAudio);
    };
  }, [audioContext]);

  // Обновление громкости
  useEffect(() => {
    const audioEl = document.getElementById("audioPlayback");
    if (audioEl) {
      audioEl.volume = volume;
    }
  }, [volume]);

  // Настройки
  const [tempMic, setTempMic] = useState("");
  const [tempVolume, setTempVolume] = useState(volume);

  useEffect(() => {
    if (showSettings) {
      setTempMic(microphones.length > 0 ? microphones[0].deviceId : "");
      setTempVolume(volume);
    }
  }, [showSettings, microphones, volume]);

  const handleSaveSettings = () => {
    onMicrophoneChange(tempMic);
    setVolume(tempVolume);
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd] p-4 flex items-center justify-center">
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 relative"
        style={{
          marginBottom: `calc(env(safe-area-inset-bottom) + 20px)`,
          minHeight: viewportHeight < 600 ? viewportHeight - 100 : 'auto',
        }}
      >
        {/* Таймер */}
        <div className="absolute top-4 right-4 bg-white px-4 py-2 rounded shadow z-10">
          <span className="font-mono">{formattedTime}</span>
        </div>

        {/* Анимация */}
        <div className="mb-8 mt-4">
          <CircleAnimation
            audioContext={audioContext}
            analyser={analyser}
            isMuted={sessionState.muted}
          />
        </div>

        {/* Панель управления */}
        <div
          className="flex items-center justify-between pt-4 border-t"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <button
            className="p-3 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors shadow-md"
            onClick={() => setShowChat(true)}
          >
            <i className="material-icons text-xl">chat</i>
          </button>

          <div className="flex gap-4">
            <button
              className="p-3 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors shadow-md"
              onClick={toggleMute}
            >
              <i className="material-icons text-xl">
                {sessionState.muted ? "mic_off" : "mic"}
              </i>
            </button>
            <button
              className="p-3 bg-red-100 hover:bg-red-200 rounded-full transition-colors shadow-md"
              onClick={terminateSession}
            >
              <i className="material-icons text-xl">meeting_room</i>
            </button>
          </div>

          <button
            className="p-3 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors shadow-md"
            onClick={() => setShowSettings(true)}
          >
            <i className="material-icons text-xl">settings</i>
          </button>
        </div>

        {/* Модальные окна */}
        {showSettings && (
          <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-30 mobile-adaptation">
            <div className="bg-white rounded-lg shadow-xl p-6 w-80 max-w-full">
              <h3 className="text-lg font-bold mb-4">Settings</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Microphone
                </label>
                <select
                  className="w-full p-2 border border-gray-300 rounded"
                  value={tempMic}
                  onChange={(e) => setTempMic(e.target.value)}
                >
                  {microphones?.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || "Default Microphone"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Site Volume
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={tempVolume}
                  onChange={(e) => setTempVolume(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex gap-4">
                <button
                  onClick={handleSaveSettings}
                  className="flex-grow bg-blue-600 hover:bg-blue-700 text-white py-2 rounded"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex-grow bg-gray-400 hover:bg-gray-500 text-white py-2 rounded"
                >
                  Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {showChat && (
          <div className="fixed inset-0 flex z-30 mobile-adaptation">
            <div className="bg-white w-80 max-w-full h-full shadow-xl transform transition-transform duration-300 ease-in-out translate-x-0">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-bold">Chat</h3>
                <button
                  onClick={() => setShowChat(false)}
                  className="text-gray-600 hover:text-gray-800"
                >
                  <i className="material-icons">close</i>
                </button>
              </div>
              <div className="p-4 scrollable-content">
                {chatMessages.length === 0 ? (
                  <p className="text-gray-500">No messages yet.</p>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`mb-2 p-2 rounded ${
                        msg.sender === "user"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      <p>{msg.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div
              className="flex-grow bg-black bg-opacity-50"
              onClick={() => setShowChat(false)}
            ></div>
          </div>
        )}
      </div>
    </div>
  );
}