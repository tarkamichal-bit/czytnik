package expo.modules.readermlkit

import android.net.Uri
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ReaderMlkitModule : Module() {
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
  private val languageId by lazy { LanguageIdentification.getClient() }

  override fun definition() = ModuleDefinition {
    Name("ReaderMlkit")

    // Text from a photo; one paragraph per ML Kit block, lines of a block joined into running text.
    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject("ERR_IMAGE", "Cannot open image: ${e.message}", e)
        return@AsyncFunction
      }
      recognizer.process(image)
        .addOnSuccessListener { result ->
          val paragraphs = result.textBlocks.map { block ->
            val sb = StringBuilder()
            for (line in block.lines) {
              val t = line.text.trim()
              if (t.isEmpty()) continue
              if (sb.isEmpty()) sb.append(t)
              else if (sb.endsWith("-")) { sb.setLength(sb.length - 1); sb.append(t) }
              else sb.append(' ').append(t)
            }
            sb.toString()
          }.filter { it.isNotBlank() }
          promise.resolve(paragraphs.joinToString("\n\n"))
        }
        .addOnFailureListener { e -> promise.reject("ERR_OCR", e.message ?: "Text recognition failed", e) }
    }

    // BCP-47 code of the main language, or "und" when unknown.
    AsyncFunction("identifyLanguage") { text: String, promise: Promise ->
      languageId.identifyLanguage(text)
        .addOnSuccessListener { code -> promise.resolve(code) }
        .addOnFailureListener { e -> promise.reject("ERR_LANGID", e.message ?: "Language identification failed", e) }
    }

    // On-device translation; downloads the language model (~30 MB) on first use of a language pair.
    AsyncFunction("translate") { text: String, from: String, to: String, promise: Promise ->
      val src = TranslateLanguage.fromLanguageTag(from)
      val tgt = TranslateLanguage.fromLanguageTag(to)
      if (src == null || tgt == null) {
        promise.reject("ERR_UNSUPPORTED_LANGUAGE", "Unsupported language pair $from -> $to", null)
        return@AsyncFunction
      }
      val translator = Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(tgt).build()
      )
      translator.downloadModelIfNeeded(DownloadConditions.Builder().build())
        .continueWithTask { task ->
          if (!task.isSuccessful) throw task.exception ?: Exception("Model download failed")
          translator.translate(text)
        }
        .addOnSuccessListener { out -> translator.close(); promise.resolve(out) }
        .addOnFailureListener { e -> translator.close(); promise.reject("ERR_TRANSLATE", e.message ?: "Translation failed", e) }
    }
  }
}
