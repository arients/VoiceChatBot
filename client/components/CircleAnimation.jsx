import { useEffect, useRef } from "react";

const CircleAnimation = ({ audioContext, analyser, isMuted }) => {
  const canvasRef = useRef(null);
  const animationFrameId = useRef(null);
  const isMounted = useRef(true);
  const circles = useRef([]);
  const gradients = useRef([]);
  const baseRadius = useRef(0);
  const smoothMultiplier = useRef(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    isMounted.current = true;

    // Обработчик для возобновления AudioContext при взаимодействии (для мобильных устройств)
    const handleUserInteraction = () => {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }
    };

    canvas.addEventListener("touchstart", handleUserInteraction);
    canvas.addEventListener("click", handleUserInteraction);

    const dpr = window.devicePixelRatio || 1;
    const size = 400;
    const w = size * dpr;
    const h = size * dpr;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const pi = Math.PI;
    const points = 12;
    baseRadius.current = 190 * dpr;
    const center = { x: w / 2, y: h / 2 };

    const lerp = (a, b, t) => a * (1 - t) + b * t;
    const random = (min, max) => Math.random() * (max - min) + min;
    const cycle = (num, max) => ((num % max) + max) % max;

    const createGradients = () => {
      gradients.current = [
        ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, baseRadius.current),
        ctx.createLinearGradient(0, 0, w, 0),
        ctx.createLinearGradient(0, 0, w, 0),
        ctx.createLinearGradient(0, 0, w, 0),
      ];

      gradients.current[0].addColorStop(0, "rgba(255,255,255,0.9)");
      gradients.current[0].addColorStop(1, "rgba(255,255,255,0.4)");

      gradients.current[1].addColorStop(0, "#70d7ff");
      gradients.current[1].addColorStop(1, "#a8d8ff");

      gradients.current[2].addColorStop(0, "#d8a8ff");
      gradients.current[2].addColorStop(1, "#e0c3fc");

      gradients.current[3].addColorStop(0, "#ff9be3");
      gradients.current[3].addColorStop(1, "#ffb3e6");
    };

    const initCircles = () => {
      circles.current = [];
      for (let idx = 0; idx < 3; idx++) { // 3 круга
        const swingpoints = [];
        for (let i = 0; i < points; i++) {
          const radian = (pi * 2 / points) * i;
          swingpoints.push({
            x: center.x + baseRadius.current * Math.cos(radian),
            y: center.y + baseRadius.current * Math.sin(radian),
            radian: radian,
            range: random(18, 25),
            phase: random(0, pi * 2),
            baseRadius: baseRadius.current,
          });
        }
        circles.current.push(swingpoints);
      }
    };

    const drawCurve = (pts, fillStyle) => {
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.moveTo(
        (pts[cycle(-1, points)].x + pts[0].x) / 2,
        (pts[cycle(-1, points)].y + pts[0].y) / 2
      );

      for (let i = 0; i < pts.length; i++) {
        ctx.quadraticCurveTo(
          pts[i].x,
          pts[i].y,
          (pts[i].x + pts[cycle(i + 1, points)].x) / 2,
          (pts[i].y + pts[cycle(i + 1, points)].y) / 2
        );
      }
      ctx.closePath();
      ctx.fill();
    };

    const updateAudioLevel = () => {
      if (!analyser || !isMounted.current) return 0;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      return Math.min(sum / dataArray.length / 255, 0.5);
    };

    const animate = () => {
      if (!isMounted.current) return;

      const rawAudioLevel = updateAudioLevel();
      const smoothAudioLevel = lerp(0.1, rawAudioLevel, 1.0);

      // Всегда используем множитель 1, поскольку логика aiState удалена
      const targetMultiplier = 1;
      smoothMultiplier.current = lerp(smoothMultiplier.current, targetMultiplier, 0.15);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.9;

      ctx.beginPath();
      ctx.arc(center.x, center.y, baseRadius.current * 0.6, 0, 2 * Math.PI);
      ctx.fillStyle = gradients.current[0];
      ctx.fill();

      circles.current.forEach((swingpoints, k) => {
        const gradientIndex = k + 1;
        if (!gradients.current[gradientIndex]) return;

        swingpoints.forEach((point) => {
          const audioEffect = 1 + smoothAudioLevel * 1.5;
          point.phase += random(-0.05, 0.05) * smoothMultiplier.current * audioEffect;

          let dynamicRadius = baseRadius.current * smoothMultiplier.current;
          // Всегда добавляем аудио-эффект, независимо от mute
          dynamicRadius += Math.min(smoothAudioLevel * 100 * dpr, 50 * dpr);

          const amplitude = point.range * Math.sin(point.phase * audioEffect);
          const targetX = center.x + (dynamicRadius + amplitude) * Math.cos(point.radian);
          const targetY = center.y + (dynamicRadius + amplitude) * Math.sin(point.radian);

          point.x = lerp(point.x, targetX, 0.2);
          point.y = lerp(point.y, targetY, 0.2);
          point.radian += (pi / 320) * (1 / smoothMultiplier.current);
        });

        ctx.shadowColor = "#70d7ff55";
        ctx.shadowBlur = 20 * dpr;
        drawCurve(swingpoints, gradients.current[gradientIndex]);
        ctx.shadowBlur = 0;
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    createGradients();
    initCircles();
    animate();

    return () => {
      isMounted.current = false;
      cancelAnimationFrame(animationFrameId.current);
      canvas.removeEventListener("touchstart", handleUserInteraction);
      canvas.removeEventListener("click", handleUserInteraction);
    };
  }, [analyser, audioContext]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-0"
      style={{ imageRendering: "crisp-edges" }}
    />
  );
};

export default CircleAnimation;
