import { NativeModule, requireNativeModule } from 'expo';

export type CropResult = { uri: string; width: number; height: number; base64: string | null };
export type Box = { left: number; top: number; width: number; height: number };
export type OcrWord = Box & { text: string };
export type OcrBlock = Box & { text: string; words: OcrWord[] };
export type OcrResult = { width: number; height: number; blocks: OcrBlock[] };

declare class ReaderMlkitModule extends NativeModule<{}> {
  /** Crops a photo to a frame given in preview-view pixels (preview shown "cover"-style). maxSide > 0 adds a scaled base64 JPEG. */
  cropToFrame(uri: string, viewW: number, viewH: number, left: number, top: number, right: number, bottom: number, maxSide: number): Promise<CropResult>;
  /** Text blocks (paragraphs / comic bubbles) with word boxes, in image pixels. */
  recognize(uri: string): Promise<OcrResult>;
  /** BCP-47 language code, or "und" when unknown. */
  identifyLanguage(text: string): Promise<string>;
  /** On-device translation; downloads the language model on first use. */
  translate(text: string, from: string, to: string): Promise<string>;
}

export default requireNativeModule<ReaderMlkitModule>('ReaderMlkit');
