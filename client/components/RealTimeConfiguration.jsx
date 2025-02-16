import React from "react";

const communicationStyles = [
  { label: "Select communication style...", value: "" },
  {
    label: "Friendly assistant 🤗",
    value: "Be polite and friendly, and help as clearly and positively as possible.",
  },
  {
    label: "Formal expert 📚",
    value: "Respond strictly to the point, using a professional tone.",
  },
  {
    label: "Joker 😆",
    value: "Respond with humour, adding jokes into the conversation.",
  },
  {
    label: "Short answers ✂️",
    value: "Respond as briefly as possible, no more than 2-3 sentences.",
  },
  {
    label: "Philosopher 🧠",
    value: "Think deeply, using metaphors and analogies.",
  },
  {
    label: "Gamer 🎮",
    value: "Communicate like a streamer, using gaming terminology and memes.",
  },
];

const voiceOptions = [
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
  { value: "verse", label: "Verse" },
];

export default function RealTimeConfiguration({
                                                config,
                                                setConfig,
                                                onCreatePrompt,
                                                onModelCreate,
                                                isMicLoading,
                                                microphones,
                                                loadingSession,
                                                loadingPrompt,
                                              }) {
  const handleStyleChange = (value) => {
    const newConfig = { ...config };
    newConfig.instructions = value || "";
    setConfig(newConfig);
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd] p-4 flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          Session Settings
        </h2>

        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Voice Type
          </label>
          <select
            value={config.voice}
            onChange={(e) => setConfig({ ...config, voice: e.target.value })}
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
            disabled={loadingSession || loadingPrompt}
          >
            {voiceOptions.map((voice) => (
              <option key={voice.value} value={voice.value}>
                {voice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Communication Style
          </label>
          <select
            value={config.instructions}
            onChange={(e) => handleStyleChange(e.target.value)}
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
            disabled={loadingSession || loadingPrompt}
          >
            {communicationStyles.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Instruction
            </label>
            <span className="text-xs text-gray-500">
              {config.instructions.length}/1000
            </span>
          </div>
          <textarea
            value={config.instructions}
            onChange={(e) =>
              setConfig({ ...config, instructions: e.target.value.slice(0, 1000) })
            }
            placeholder="Enter custom instructions..."
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm h-32 resize-none"
            disabled={loadingSession || loadingPrompt}
          />
        </div>

        <button
          onClick={() => {
            onCreatePrompt();
            handleStyleChange("");
          }}
          disabled={loadingSession || loadingPrompt}
          className={`w-full mb-5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium py-2.5 px-4 rounded-lg transition-colors text-sm ${
            loadingSession || loadingPrompt ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loadingPrompt ? (
            <div className="flex items-center justify-center space-x-2">
              <svg
                className="animate-spin h-5 w-5 text-emerald-700"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span>Loading prompt...</span>
            </div>
          ) : (
            "Generate Prompt"
          )}
        </button>

        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Temperature ({config.temperature})
            </label>
            <span className="text-xs text-gray-500">
              {parseFloat(config.temperature) === 0.8
                ? "Balanced"
                : parseFloat(config.temperature) < 0.8
                  ? "Conservative"
                  : "Creative"}{" "}
              responses
            </span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.2"
            step="0.1"
            value={config.temperature}
            onChange={(e) => setConfig({ ...config, temperature: e.target.value })}
            className="w-full"
            disabled={loadingSession || loadingPrompt}
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Microphone
          </label>
          {isMicLoading ? (
            <div className="animate-pulse bg-gray-100 h-10 rounded-lg" />
          ) : (
            <select
              value={config.microphoneId}
              onChange={(e) => setConfig({ ...config, microphoneId: e.target.value })}
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              disabled={loadingSession || loadingPrompt}
            >
              {microphones.map((mic) => (
                <option key={mic.deviceId} value={mic.deviceId}>
                  {mic.label || "Default Microphone"}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="flex items-center space-x-3 mb-6 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
          <input
            type="checkbox"
            checked={config.startWithMicDisabled}
            onChange={(e) => setConfig({ ...config, startWithMicDisabled: e.target.checked })}
            className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
            disabled={loadingSession || loadingPrompt}
          />
          <span className="text-sm text-gray-700">Start with microphone muted</span>
        </label>

        <button
          onClick={onModelCreate}
          disabled={loadingSession || loadingPrompt}
          className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3.5 px-6 rounded-lg transition-all text-sm transform hover:scale-105 ${
            loadingSession || loadingPrompt ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loadingSession ? (
            <div className="flex items-center justify-center space-x-2">
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span>Loading session...</span>
            </div>
          ) : (
            "Start Session"
          )}
        </button>
      </div>
    </div>
  );
}
