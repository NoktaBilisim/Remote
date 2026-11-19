### test-linux-gui Ubuntu 24.04

- tamam: Go go1.26.11
- tamam: 11 beyaz liste öğesi var (LGPL / MIT/X11), H.264/GPL kodlayıcı yok
- tamam: XI2 ofsetleri üretildi (38 satır)
- tamam: Xvfb :99 + oturum D-Bus hazır
- tamam: ELF derlendi ve denetlendi
- UYARI: strace emülasyonda çalışmıyor; ortam pozitif kontrolü bu koşuda YAPILAMADI (CI yerli amd64'te zorunlu)
- HATA: go test (x11) çıkış kodu 1

<details><summary>go test x11 SKIP listesi</summary>

```
--- SKIP: TestAC402LinuxPulseDeviceRoundTrip (0.03s)
```
</details>
- tamam: iz testi temiz
- tamam: Wayland katmanı hazır (mutter başsız + portal ScreenCast)
- HATA: TestP28gK3GUIXTestClick PASS değil (FAIL)
- **KALDI**
