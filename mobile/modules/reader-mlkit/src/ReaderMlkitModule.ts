import { NativeModule, requireNativeModule } from 'expo';

export type CropResult = { uri: string; width: number; height: number; base64: string | null };
export type Box = { left: number; top: number; width: number; height: number };
export type OcrWord = Box & { text: string };
export type OcrBlock = Box & { text: string; words: OcrWord[] };
export type OcrResult = { width: number; height: number; blocks: OcrBlock[] };
export type SavedPage = { uri: string; width: number; height: number };

declare class ReaderMlkitModule extends NativeModule<{}> {
  /** Crops a photo to a frame given in preview-view pixels (preview shown "cover"-style). maxSide > 0 adds a scaled base64 JPEG. */
  cropToFrame(uri: string, viewW: number, viewH: number, left: number, top: number, right: number, bottom: number, maxSide: number): Promise<CropResult>;
  /** Text blocks (paragraphs / comic bubbles) with word boxes, in image pixels. */
  recognize(uri: string): Promise<OcrResult>;
  /** BCP-47 language code, or "und" when unknown. */
  identifyLanguage(text: string): Promise<string>;
  /** On-device translation; downloads the language model on first use. */
  translate(text: string, from: string, to: string): Promise<string>;
  /** Saves an upright copy of a comic page in the app's private storage. */
  savePage(srcUri: string, comicId: string, name: string): Promise<SavedPage>;
  /** Deletes all stored pages of a comic. */
  deleteComic(comicId: string): Promise<boolean>;
  /** Paints white over strokes (x,y pairs in image pixels; counts = points per stroke). Returns the new image. */
  erase(uri: string, points: number[], counts: number[], brush: number): Promise<SavedPage>;
  /** Turns a tilted page photo straight (angle in degrees; 0 = already straight, same uri). */
  straighten(uri: string): Promise<SavedPage & { angle: number }>;
  /** Comic panels in reading order (image pixels). */
  detectPanels(uri: string): Promise<Box[]>;
}

export default requireNativeModule<ReaderMlkitModule>('ReaderMlkit');
