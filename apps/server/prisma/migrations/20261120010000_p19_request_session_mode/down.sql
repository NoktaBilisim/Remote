-- P19 J2 geri alma: BROWSER talep oturumu varsa ADD CONSTRAINT 3819 ile durur (veri kaybı yok; önce P19 down kuralları).
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_request_mode_chk` CHECK (`request_id` IS NULL OR `mode` IS NULL OR `mode` = 'AGENT');
