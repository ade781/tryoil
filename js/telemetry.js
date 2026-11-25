/**
 * Tryoil Telemetry, Estimator & Latency Benchmark
 * Pure vanilla JS — zero external dependencies.
 */

(() => {
  "use strict";

  const GRADE_SPECS = {
    synthetic: {
      label: "Synthetic PAO",
      pricePerLiter: 98000,
      baseDrainHours: 6000,
      optimalTemp: 85,
      tempTolerance: 35,
      vis40: 150,
      vis100: 19.5,
      baseStability: 99.2,
      decayRate: 0.000018,
    },
    hydraulic: {
      label: "Hydraulic Anti-Wear",
      pricePerLiter: 62000,
      baseDrainHours: 4000,
      optimalTemp: 65,
      tempTolerance: 28,
      vis40: 46,
      vis100: 6.8,
      baseStability: 98.0,
      decayRate: 0.000032,
    },
    marine: {
      label: "Marine Cylinder",
      pricePerLiter: 78000,
      baseDrainHours: 5000,
      optimalTemp: 80,
      tempTolerance: 32,
      vis40: 110,
      vis100: 14.2,
      baseStability: 98.6,
      decayRate: 0.000024,
    },
  };

  const currencyFmt = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  const numberFmt = new Intl.NumberFormat("id-ID");

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function getGradeSpec(gradeKey) {
    return GRADE_SPECS[gradeKey] || GRADE_SPECS.synthetic;
  }

  /**
   * Estimate kinematic viscosity (cSt) at temperature T (°C) using a smooth
   * Walther-like exponential interpolation anchored at 40°C and 100°C.
   */
  function estimateViscosity(spec, tempC) {
    const t = clamp(tempC, 20, 140);
    const k = Math.log(spec.vis40 / spec.vis100) / (1 / 313.15 - 1 / 373.15);
    const vis = spec.vis100 * Math.exp(k * (1 / (t + 273.15) - 1 / 373.15));
    return Math.max(1.5, vis);
  }

  /**
   * Estimate thermal stability index (%) at operating hours h (0..5000)
   * adjusted by current operating temperature stress.
   */
  function estimateThermalStability(spec, hours, tempC) {
    const overheat = Math.max(0, tempC - spec.optimalTemp);
    const stressFactor = 1 + (overheat / 25) * 0.65;
    const drop = spec.decayRate * stressFactor * Math.pow(hours, 1.32);
    return clamp(spec.baseStability - drop, 45, 100);
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return (...args) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, waitMs);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Viscosity & Cost Estimator ---
    const calcVolume = document.getElementById("calcVolume");
    const calcHours = document.getElementById("calcHours");
    const calcTemp = document.getElementById("calcTemp");
    const calcTempVal = document.getElementById("calcTempVal");
    const calcGrade = document.getElementById("calcGrade");

    const outMonthlyCost = document.getElementById("outMonthlyCost");
    const outAnnualCost = document.getElementById("outAnnualCost");
    const outInterval = document.getElementById("outInterval");
    const outEfficiency = document.getElementById("outEfficiency");

    // --- 2. Canvas Telemetry Chart ---
    const canvas = document.getElementById("telemetryChart");
    const modeButtons = Array.from(document.querySelectorAll("[data-chart-mode]"));
    let activeChartMode = "viscosity";

    function getCurrentInputs() {
      const volume = clamp(Number(calcVolume?.value) || 400, 1, 100000);
      const hours = clamp(Number(calcHours?.value) || 16, 1, 24);
      const temp = clamp(Number(calcTemp?.value) || 85, 20, 140);
      const grade = calcGrade?.value || "synthetic";
      return { volume, hours, temp, grade };
    }

    function updateEstimator() {
      const { volume, hours, temp, grade } = getCurrentInputs();
      const spec = getGradeSpec(grade);

      if (calcTempVal) {
        calcTempVal.textContent = `${temp} °C`;
      }

      // Thermal stress & operating duty adjustments
      const tempDelta = temp - spec.optimalTemp;
      const overheatPenalty = tempDelta > 0 ? Math.pow(tempDelta / spec.tempTolerance, 1.35) * 0.28 : 0;
      const coldPenalty = tempDelta < -25 ? Math.abs(tempDelta + 25) * 0.0025 : 0;
      const dutyMultiplier = 0.85 + (hours / 24) * 0.3;

      const drainHours = Math.round(
        clamp(spec.baseDrainHours * (1 - overheatPenalty), 1200, spec.baseDrainHours * 1.05)
      );
      const drainDays = Math.max(1, Math.round(drainHours / hours));

      // Effective monthly cost factors in oil volume, grade price, duty cycle, and thermal degradation
      const thermalWasteFactor = 1 + overheatPenalty * 0.45;
      const monthlyCost = Math.round(volume * spec.pricePerLiter * dutyMultiplier * thermalWasteFactor);
      const annualCost = monthlyCost * 12;

      const efficiencyScore = clamp(
        98.5 - overheatPenalty * 42 - coldPenalty * 100 - (hours > 20 ? 1.2 : 0),
        62,
        99.4
      );

      if (outMonthlyCost) {
        outMonthlyCost.textContent = currencyFmt.format(monthlyCost);
      }
      if (outAnnualCost) {
        outAnnualCost.textContent = currencyFmt.format(annualCost);
      }
      if (outInterval) {
        outInterval.textContent = `${numberFmt.format(drainHours)} jam (${numberFmt.format(drainDays)} hari)`;
      }
      if (outEfficiency) {
        outEfficiency.textContent = `${efficiencyScore.toFixed(1)}%`;
      }
    }

    function buildChartSeries(mode) {
      const { temp, grade } = getCurrentInputs();
      const spec = getGradeSpec(grade);
      const points = [];

      if (mode === "thermal") {
        const steps = 10; // 0h .. 5000h in 500h increments
        for (let i = 0; i <= steps; i += 1) {
          const h = i * 500;
          points.push({
            x: h,
            y: estimateThermalStability(spec, h, temp),
            xLabel: `${h}h`,
          });
        }
        return {
          points,
          yMin: 40,
          yMax: 100,
          yUnit: "%",
          title: `Stabilitas Termal — ${spec.label} (${temp}°C)`,
          formatY: (v) => `${Math.round(v)}%`,
          formatPoint: (v) => `${v.toFixed(1)}%`,
        };
      }

      // Default: viscosity mode (20°C .. 140°C)
      const temps = [20, 35, 50, 65, 80, 95, 110, 125, 140];
      let maxVis = 0;
      for (const t of temps) {
        const vis = estimateViscosity(spec, t);
        if (vis > maxVis) maxVis = vis;
        points.push({
          x: t,
          y: vis,
          xLabel: `${t}°C`,
        });
      }

      const niceMax = Math.ceil((maxVis * 1.12) / 50) * 50 || 100;
      return {
        points,
        yMin: 0,
        yMax: niceMax,
        yUnit: "cSt",
        title: `Kurva Viskositas — ${spec.label}`,
        formatY: (v) => `${Math.round(v)}`,
        formatPoint: (v) => `${v.toFixed(1)} cSt`,
      };
    }

    function drawTelemetryChart() {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const cssWidth = Math.max(280, Math.floor(rect.width || canvas.clientWidth || 760));
      const cssHeight = Math.max(220, Math.floor(rect.height || Number(canvas.getAttribute("height")) || 280));

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Clear background
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const series = buildChartSeries(activeChartMode);
      const { points, yMin, yMax, title, formatY, formatPoint } = series;

      const pad = { top: 34, right: 24, bottom: 38, left: 52 };
      const plotW = cssWidth - pad.left - pad.right;
      const plotH = cssHeight - pad.top - pad.bottom;

      if (plotW <= 0 || plotH <= 0) return;

      // Chart title
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = "#e6edf3";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(title, pad.left, 16);

      // Horizontal gridlines & Y-axis labels
      const yTicks = 5;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (let i = 0; i <= yTicks; i += 1) {
        const ratio = i / yTicks;
        const yVal = yMin + (yMax - yMin) * (1 - ratio);
        const yPos = pad.top + plotH * ratio;

        ctx.beginPath();
        ctx.strokeStyle = i === yTicks ? "#334155" : "#232b38";
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, Math.round(yPos) + 0.5);
        ctx.lineTo(pad.left + plotW, Math.round(yPos) + 0.5);
        ctx.stroke();

        ctx.fillStyle = "#8b949e";
        ctx.fillText(formatY(yVal), pad.left - 8, yPos);
      }

      // Compute pixel coordinates
      const coords = points.map((pt, idx) => {
        const xPos = pad.left + (idx / (points.length - 1)) * plotW;
        const normY = (pt.y - yMin) / (yMax - yMin || 1);
        const yPos = pad.top + plotH - clamp(normY, 0, 1) * plotH;
        return { ...pt, px: xPos, py: yPos };
      });

      // Vertical gridlines & X-axis labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      coords.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(35, 43, 56, 0.55)";
        ctx.lineWidth = 1;
        ctx.moveTo(Math.round(pt.px) + 0.5, pad.top);
        ctx.lineTo(Math.round(pt.px) + 0.5, pad.top + plotH);
        ctx.stroke();

        // Skip alternating X labels on narrow screens to prevent overlap
        if (cssWidth >= 460 || idx % 2 === 0 || idx === coords.length - 1) {
          ctx.fillStyle = "#8b949e";
          ctx.fillText(pt.xLabel, pt.px, pad.top + plotH + 10);
        }
      });

      // Area gradient fill under curve
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
      grad.addColorStop(0, "rgba(245, 158, 11, 0.30)");
      grad.addColorStop(1, "rgba(245, 158, 11, 0.01)");

      ctx.beginPath();
      coords.forEach((pt, idx) => {
        if (idx === 0) {
          ctx.moveTo(pt.px, pt.py);
        } else {
          ctx.lineTo(pt.px, pt.py);
        }
      });
      ctx.lineTo(coords[coords.length - 1].px, pad.top + plotH);
      ctx.lineTo(coords[0].px, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Main line stroke
      ctx.beginPath();
      coords.forEach((pt, idx) => {
        if (idx === 0) {
          ctx.moveTo(pt.px, pt.py);
        } else {
          ctx.lineTo(pt.px, pt.py);
        }
      });
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      // Data points & subtle value callouts at endpoints + midpoint
      coords.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#0c0f14";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#f59e0b";
        ctx.stroke();

        if (idx === 0 || idx === Math.floor(coords.length / 2) || idx === coords.length - 1) {
          ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillStyle = "#e6edf3";
          ctx.textAlign = idx === 0 ? "left" : idx === coords.length - 1 ? "right" : "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(formatPoint(pt.y), pt.px, pt.py - 8);
        }
      });
    }

    const handleEstimatorChange = () => {
      updateEstimator();
      drawTelemetryChart();
    };

    [calcVolume, calcHours, calcTemp, calcGrade].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", handleEstimatorChange);
      el.addEventListener("change", handleEstimatorChange);
    });

    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-chart-mode");
        if (!mode || mode === activeChartMode) return;
        activeChartMode = mode;

        modeButtons.forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        drawTelemetryChart();
      });
    });

    window.addEventListener("resize", debounce(drawTelemetryChart, 120));

    // Initial calculation & chart render
    updateEstimator();
    drawTelemetryChart();

    // --- 3. Server Latency Benchmark ---
    const pingBtn = document.getElementById("pingBtn");
    const pingLast = document.getElementById("pingLast");
    const pingAvg = document.getElementById("pingAvg");
    const pingStatus = document.getElementById("pingStatus");

    if (pingBtn) {
      pingBtn.addEventListener("click", async () => {
        pingBtn.disabled = true;
        const samples = [];
        const totalRuns = 3;

        if (pingStatus) {
          pingStatus.textContent = `Menguji (1/${totalRuns})...`;
        }

        try {
          for (let i = 0; i < totalRuns; i += 1) {
            if (pingStatus) {
              pingStatus.textContent = `Menguji (${i + 1}/${totalRuns})...`;
            }

            const start = performance.now();
            await fetch(window.location.href, {
              method: "HEAD",
              cache: "no-store",
            });
            const elapsed = Math.max(1, Math.round(performance.now() - start));
            samples.push(elapsed);

            if (pingLast) {
              pingLast.textContent = `${elapsed} ms`;
            }

            const runningAvg = Math.round(
              samples.reduce((sum, v) => sum + v, 0) / samples.length
            );
            if (pingAvg) {
              pingAvg.textContent = `${runningAvg} ms`;
            }
          }

          const finalAvg = Math.round(
            samples.reduce((sum, v) => sum + v, 0) / samples.length
          );
          if (pingStatus) {
            if (finalAvg <= 80) {
              pingStatus.textContent = "Optimal";
            } else if (finalAvg <= 200) {
              pingStatus.textContent = "Stabil";
            } else {
              pingStatus.textContent = "Tinggi";
            }
          }
        } catch {
          if (pingStatus) {
            pingStatus.textContent = "Gagal terhubung";
          }
        } finally {
          pingBtn.disabled = false;
        }
      });
    }
  });
})();
