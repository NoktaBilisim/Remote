import { GuestEndScreen, GuestShell } from "../guest-ui";

/** Biçimsiz veya bilinmeyen token: HTTP 404 + müşteriye yönlendirici ekran (panel 404'ü değil). */
export default function GuestNotFound() {
  return (
    <GuestShell>
      <GuestEndScreen kind="notFound" />
    </GuestShell>
  );
}
