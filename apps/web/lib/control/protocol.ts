/*
 * P7 uzaktan kontrol tipleri — tek kaynak `packages/contracts` (ws.ts: control.*, monitor.request, env.state,
 * caps.update; dc.ts: `input` kanalı). Bu dosya yalnız web tarafında kullanılan adları yeniden dışa verir.
 */
export { CONTROL_DENY_COOLDOWN_MS, CONTROL_REQUEST_MAX, CONTROL_SOURCES, type ControlSource } from "@remote/contracts/ws";
export { inputMessageSchema as inputMsgSchema, MOUSE_BUTTONS, WHEEL_MAX, type InputMessage as InputMsg } from "@remote/contracts/dc";
export type MouseButton = (typeof import("@remote/contracts/dc").MOUSE_BUTTONS)[number];
