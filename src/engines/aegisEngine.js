import {
  calcMACD,
  calcRSI,
  calcOBV,
  calcMFI,
  calcMA60,
  calcPositionBands,
} from "./technicalEngine";

import { buildBubbleEnergyModel } from "./bubbleEngine";

const sqClamp = (v, min, max) => Math.min(max, Math.max(min, v));

const sqNum = (v, d = 2) =>
  Number.isFinite(Number(v)) ? +Number(v).toFixed(d) : null;

const sqMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
