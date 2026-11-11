import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code for a link, so a phone can open it from a TV screen or across the room. */
export function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="hub-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}
