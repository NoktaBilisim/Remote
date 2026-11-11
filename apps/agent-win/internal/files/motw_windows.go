//go:build windows

package files

import "os"

// zoneInternet MOTW içeriği (ZoneId=3 = Internet): SmartScreen ve Office Korumalı Görünüm devreye girer (G-06).
const zoneInternet = "[ZoneTransfer]\r\nZoneId=3\r\n"

// WriteMOTW dosya kapandıktan sonra `<yol>:Zone.Identifier` ADS'ine Internet bölgesini yazar (mimari-protokol §4.2/3).
// Transfer bunu `.part`'a yeniden adlandırmadan önce çağırır (S6-3; ADS dosyayla taşınır). NTFS dışı birimde
// (FAT32/exFAT) ADS yazılamaz; hata döner: tehlikeli türde dosya silinir, diğerlerinde kullanıcı uyarılır.
func WriteMOTW(path string) error {
	return os.WriteFile(path+":Zone.Identifier", []byte(zoneInternet), 0o644)
}
