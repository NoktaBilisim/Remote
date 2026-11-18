/*
 * P28g K8a (mimari-p28g §5.4 "X11 FFI kuralları" m.1, D-P28g-T2-2; ADR-0038 m.6): Go (purego) tarafının C belleğinden
 * okuduğu XI2 / Xlib yapı alanlarının ofsetlerini ve boyutlarını, imajdaki libx11-dev + libxi-dev başlıklarından yazar.
 * test/linux/run-gui-tests.sh bunu her imajda (22.04 + 24.04) derler, çıktıyı P28G_XI2_OFFSETS ile Go testine verir
 * (TestP28gK3XI2OffsetsMatchHeaders; sözleşme docs/implementation.md "P28g K8a"). Biçim: satır başına `Ad.alan=sayı`,
 * boyutlar `sizeof.Ad=sayı`. Yalnız ekleme yapılır; var olan anahtarın adı değişmez (Go testi anahtar adıyla arar).
 */
#include <stddef.h>
#include <stdio.h>
#include <X11/Xlib.h>
#include <X11/extensions/XInput2.h>

#define OFF(T, f) printf("%s.%s=%zu\n", #T, #f, offsetof(T, f))
#define SIZE(T) printf("sizeof.%s=%zu\n", #T, sizeof(T))

int main(void) {
    SIZE(XEvent);
    OFF(XGenericEventCookie, type);
    OFF(XGenericEventCookie, extension);
    OFF(XGenericEventCookie, evtype);
    OFF(XGenericEventCookie, cookie);
    OFF(XGenericEventCookie, data);

    OFF(XIRawEvent, extension);
    OFF(XIRawEvent, evtype);
    OFF(XIRawEvent, deviceid);
    OFF(XIRawEvent, sourceid);
    OFF(XIRawEvent, detail);

    OFF(XIDeviceEvent, extension);
    OFF(XIDeviceEvent, evtype);
    OFF(XIDeviceEvent, deviceid);
    OFF(XIDeviceEvent, sourceid);
    OFF(XIDeviceEvent, detail);

    SIZE(XIEventMask);
    OFF(XIEventMask, deviceid);
    OFF(XIEventMask, mask_len);
    OFF(XIEventMask, mask);

    SIZE(XIDeviceInfo);
    OFF(XIDeviceInfo, deviceid);
    OFF(XIDeviceInfo, name);
    OFF(XIDeviceInfo, use);
    OFF(XIDeviceInfo, attachment);
    OFF(XIDeviceInfo, enabled);

    /* K3 ekleri: XI2 izleyici kapanışı (ClientMessage) ve kapatma kısayolu GDK süzgeci (XKeyEvent). */
    OFF(XClientMessageEvent, window);
    OFF(XClientMessageEvent, format);
    OFF(XKeyEvent, type);
    OFF(XKeyEvent, state);
    OFF(XKeyEvent, keycode);
    return 0;
}
