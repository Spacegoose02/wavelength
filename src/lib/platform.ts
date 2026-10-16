import { useEffect, useState } from 'react';

/** Running inside the Android app (yt-dlp, SMB shares etc. are desktop-only). */
export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const PHONE = '(max-width: 760px)';

/** Phone-sized layout (Android, or a narrow desktop window). */
export function useIsPhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
