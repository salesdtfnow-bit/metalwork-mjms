"use client";

import { useState } from "react";
import { d } from "@/lib/decimal";
import { Badge, cx } from "@/components/ui";

export type GridChar = {
  id: string;
  balloonNo: string | null;
  name: string;
  charType: string;
  specification: string | null;
  nominal: string | null;
  tolMinus: string | null;
  tolPlus: string | null;
  unit: string | null;
  method: string | null;
  instrumentType: string | null;
  isCritical: boolean;
  evidenceRequired: boolean;
  cells: {
    sampleNo: number;
    result: string;
    measuredValue: string | null;
    attributeResult: string | null;
    instrumentId: string | null;
    comment: string | null;
    underReview: boolean;
  }[];
};

export type GridInstrument = { id: string; assetNo: string; description: string; instrumentType: string; ok: boolean; reason: string };

const MEASURED = ["dimensional", "hardness", "surface"];
const NUM = /^-?\d+(\.\d+)?$/;

const isMeasured = (c: Pick<GridChar, "charType" | "nominal">) => MEASURED.includes(c.charType) && c.nominal !== null;

/** Display a stored numeric (trims trailing zeros). */
function show(v: string | null | undefined) {
  if (v === null || v === undefined || v === "") return "";
  try {
    return d(v).toString();
  } catch {
    return v;
  }
}

function limits(c: GridChar) {
  if (!isMeasured(c)) return null;
  const lo = d(c.nominal).plus(d(c.tolMinus ?? 0));
  const hi = d(c.nominal).plus(d(c.tolPlus ?? 0));
  return { lo, hi };
}

/** Client-side preview only — the server re-evaluates every value. */
function preview(c: GridChar, value: string, attr: string): "pass" | "fail" | "missing" | "invalid" {
  if (isMeasured(c)) {
    const v = value.trim().replace(/,/g, "");
    if (!v) return "missing";
    if (!NUM.test(v)) return "invalid";
    const l = limits(c)!;
    const n = d(v);
    return n.greaterThanOrEqualTo(l.lo) && n.lessThanOrEqualTo(l.hi) ? "pass" : "fail";
  }
  return attr === "pass" || attr === "fail" ? attr : "missing";
}

export function ResultBadge({ result }: { result: string }) {
  if (result === "pass") return <Badge tone="success">Pass</Badge>;
  if (result === "fail") return <Badge tone="danger">Fail</Badge>;
  if (result === "invalid") return <Badge tone="danger">Not a number</Badge>;
  return (
    <Badge tone="warning" className="border-dashed font-semibold uppercase tracking-wide">
      Missing
    </Badge>
  );
}

export function ResultsGrid({ chars, instruments, editable }: { chars: GridChar[]; instruments: GridInstrument[]; editable: boolean }) {
  // key: `${charId}_${sample}` → current input text
  const [values, setValues] = useState<Record<string, string>>({});
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [insts, setInsts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of chars) for (const cell of c.cells) if (cell.instrumentId) init[`${c.id}_${cell.sampleNo}`] = cell.instrumentId;
    return init;
  });
  const [defaultInst, setDefaultInst] = useState("");

  const valid = instruments.filter((i) => i.ok);
  const invalid = instruments.filter((i) => !i.ok);

  const applyDefault = (id: string) => {
    setDefaultInst(id);
    if (!id) return;
    setInsts((cur) => {
      const next = { ...cur };
      for (const c of chars) if (isMeasured(c)) for (const cell of c.cells) next[`${c.id}_${cell.sampleNo}`] ||= id;
      return next;
    });
  };

  const instrumentSelect = (key: string, label: string) => (
    <select
      name={`i_${key}`}
      aria-label={`Instrument for ${label}`}
      value={insts[key] ?? ""}
      onChange={(e) => setInsts((cur) => ({ ...cur, [key]: e.target.value }))}
      className="field-input min-w-[150px] py-1 text-[12.5px]"
      disabled={!editable}
    >
      <option value="">— instrument —</option>
      {valid.map((i) => (
        <option key={i.id} value={i.id}>
          {i.assetNo} · {i.description}
        </option>
      ))}
      {invalid.length > 0 && (
        <optgroup label="Not usable (calibration / status)">
          {invalid.map((i) => (
            <option key={i.id} value={i.id} disabled>
              {i.assetNo} — {i.reason}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  return (
    <div>
      {editable && (
        <div className="mb-2 flex flex-wrap items-end gap-3 text-[12.5px]">
          <label className="flex items-center gap-2 text-ink-2">
            Fill blank instrument cells with
            <select value={defaultInst} onChange={(e) => applyDefault(e.target.value)} className="field-input w-auto py-1 text-[12.5px]">
              <option value="">— choose —</option>
              {valid.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.assetNo} · {i.description}
                </option>
              ))}
            </select>
          </label>
          <span className="text-steel">Only instruments in service with valid calibration can be selected. The live check below is a preview — the server evaluates every value when you save.</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-line bg-sheet">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Balloon</th>
              <th scope="col">Characteristic</th>
              <th scope="col">Specification</th>
              <th scope="col" className="text-right">Nominal</th>
              <th scope="col" className="text-right">Tol −/+</th>
              <th scope="col" className="text-right">LSL</th>
              <th scope="col" className="text-right">USL</th>
              <th scope="col">Sample</th>
              <th scope="col">Recorded</th>
              <th scope="col">Measured / result</th>
              <th scope="col">Instrument</th>
              <th scope="col">Comment</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {chars.map((c) => {
              const l = limits(c);
              const measured = isMeasured(c);
              return c.cells.map((cell, idx) => {
                const key = `${c.id}_${cell.sampleNo}`;
                const typed = values[key] ?? "";
                const typedAttr = attrs[key] ?? "";
                const touched = measured ? typed.trim() !== "" : typedAttr !== "";
                const live = touched ? preview(c, typed, typedAttr) : null;
                const label = `${c.name} sample ${cell.sampleNo}`;
                return (
                  <tr key={key} className={cx(cell.result === "missing" && !touched && "bg-amber-50/40", (live ?? cell.result) === "fail" && "bg-red-50/60")}>
                    {idx === 0 ? (
                      <>
                        <td rowSpan={c.cells.length} className="plate align-top">
                          {c.balloonNo ?? "—"}
                        </td>
                        <td rowSpan={c.cells.length} className="align-top">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-[12px] text-steel">
                            {c.charType}
                            {c.method ? ` · ${c.method}` : ""}
                            {c.instrumentType ? ` · ${c.instrumentType}` : ""}
                          </div>
                          {c.isCritical && <Badge tone="danger">Critical</Badge>} {c.evidenceRequired && <Badge tone="info">Evidence required</Badge>}
                        </td>
                        <td rowSpan={c.cells.length} className="max-w-[200px] align-top whitespace-pre-wrap text-steel">
                          {c.specification ?? "—"}
                        </td>
                        <td rowSpan={c.cells.length} className="plate text-right align-top">
                          {show(c.nominal) || "—"}
                          {c.unit && c.nominal !== null ? <span className="ml-1 text-steel">{c.unit}</span> : null}
                        </td>
                        <td rowSpan={c.cells.length} className="plate text-right align-top whitespace-nowrap">
                          {measured ? `${show(c.tolMinus) || "0"} / +${show(c.tolPlus) || "0"}` : "—"}
                        </td>
                        <td rowSpan={c.cells.length} className="plate text-right align-top">
                          {l ? l.lo.toString() : "—"}
                        </td>
                        <td rowSpan={c.cells.length} className="plate text-right align-top">
                          {l ? l.hi.toString() : "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="plate">{cell.sampleNo}</td>
                    <td className="whitespace-nowrap">
                      <span className="plate mr-1.5">{measured ? show(cell.measuredValue) : cell.attributeResult ?? ""}</span>
                      <ResultBadge result={cell.result} />
                      {cell.underReview && (
                        <Badge tone="hold" className="ml-1">
                          Under review
                        </Badge>
                      )}
                    </td>
                    <td>
                      {measured ? (
                        <input
                          name={`v_${key}`}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Measured value for ${label}`}
                          placeholder={cell.measuredValue ? show(cell.measuredValue) : c.unit ?? ""}
                          value={typed}
                          onChange={(e) => setValues((cur) => ({ ...cur, [key]: e.target.value }))}
                          disabled={!editable}
                          className={cx("field-input plate w-28 py-1 text-right", live === "fail" && "border-red text-red", live === "invalid" && "border-red", live === "pass" && "border-green")}
                        />
                      ) : (
                        <select
                          name={`a_${key}`}
                          aria-label={`Result for ${label}`}
                          value={typedAttr}
                          onChange={(e) => setAttrs((cur) => ({ ...cur, [key]: e.target.value }))}
                          disabled={!editable}
                          className="field-input w-28 py-1"
                        >
                          <option value="">—</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </select>
                      )}
                    </td>
                    <td>{instrumentSelect(key, label)}</td>
                    <td>
                      <input name={`c_${key}`} aria-label={`Comment for ${label}`} defaultValue={cell.comment ?? ""} disabled={!editable} className="field-input min-w-[140px] py-1 text-[12.5px]" />
                    </td>
                    <td>{live ? <ResultBadge result={live} /> : <span className="text-[12px] text-steel">—</span>}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
