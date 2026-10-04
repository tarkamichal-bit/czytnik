import { NativeModule, requireNativeModule } from 'expo';

declare class ReaderMlkitModule extends NativeModule<{}> {
  /** Recognized text from an image file URI; paragraphs separated by a blank line. */
  recognize(uri: string): Promise<string>;
  /** BCP-47 language code, or "und" when unknown. */
  identifyLanguage(text: string): Promise<string>;
  /** On-device translation; downloads the language model on first use. */
  translate(text: string, from: string, to: string): Promise<string>;
}

export default requireNativeModule<ReaderMlkitModule>('ReaderMlkit');
