import React, { useEffect, useState } from "react";

export default function RealTimeConfiguration({
                                                config,
                                                setConfig,
                                                onCreatePrompt,
                                                onModelCreate,
                                                isMicLoading,
                                                microphones
                                              }) {

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

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#ffc3a0] to-[#ffafbd] p-4 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          Real-Time Settings
        </h2>

        {/* Voice Selection */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Voice Style
          </label>
          <select
            value={config.voice}
            onChange={(e) => setConfig({ ...config, voice: e.target.value })}
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
          >
            {voiceOptions.map((voice) => (
              <option key={voice.value} value={voice.value}>
                {voice.label}
              </option>
            ))}
          </select>
        </div>

        {/* Instructions Input */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Custom Instructions
            </label>
            <span className="text-xs text-gray-500">
              {config.instructions.length}/1000
            </span>
          </div>
          <textarea
            value={config.instructions}
            onChange={(e) =>
              setConfig({
                ...config,
                instructions: e.target.value.slice(0, 1000),
              })
            }
            placeholder="Example: Speak like a friendly tech assistant..."
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm h-32 resize-none"
          />
        </div>

        {/* Generate Prompt Button */}
        <button
          onClick={onCreatePrompt}
          className="w-full mb-5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium py-2.5 px-4 rounded-lg transition-colors duration-200 text-sm"
        >
          Generate AI Prompt
        </button>

        {/* Microphone Selection */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Microphone
          </label>
          {isMicLoading ? (
            <div className="animate-pulse bg-gray-100 h-10 rounded-lg" />
          ) : (
            <select
              value={config.microphoneId}
              onChange={(e) =>
                setConfig({ ...config, microphoneId: e.target.value })
              }
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
            >
              {microphones.map((mic) => (
                <option key={mic.deviceId} value={mic.deviceId}>
                  {mic.label || "Default Microphone"}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Mic Disabled Toggle */}
        <label className="flex items-center space-x-3 mb-6 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={config.startWithMicDisabled}
            onChange={(e) =>
              setConfig({ ...config, startWithMicDisabled: e.target.checked })
            }
            className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            Start with microphone muted
          </span>
        </label>

        {/* Start Button */}
        <button
          onClick={onModelCreate}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3.5 px-6 rounded-lg transition-all duration-200 text-sm transform hover:scale-[1.02] active:scale-95"
        >
          Start Real-Time Session
        </button>
      </div>
    </div>
  );
}