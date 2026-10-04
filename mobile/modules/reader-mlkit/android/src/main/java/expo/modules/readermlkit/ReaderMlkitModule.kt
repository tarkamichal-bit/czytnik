package expo.modules.readermlkit

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
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
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class ReaderMlkitModule : Module() {
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
  private val languageId by lazy { LanguageIdentification.getClient() }

  override fun definition() = ModuleDefinition {
    Name("ReaderMlkit")

    // Crops the photo to the on-screen frame. The preview fills the view "cover"-style, so the
    // frame (view pixels) is mapped back onto the upright photo. Returns the cropped JPEG file and,
    // when maxSide > 0, a base64 JPEG scaled so its longer side is at most maxSide.
    AsyncFunction("cropToFrame") { uri: String, viewW: Double, viewH: Double, left: Double, top: Double, right: Double, bottom: Double, maxSide: Int ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val src = upright(context, Uri.parse(uri))
      val bw = src.width.toDouble()
      val bh = src.height.toDouble()
      val scale = max(viewW / bw, viewH / bh)
      val offX = (viewW - bw * scale) / 2.0
      val offY = (viewH - bh * scale) / 2.0
      val x0 = ((left - offX) / scale).coerceIn(0.0, bw - 1)
      val y0 = ((top - offY) / scale).coerceIn(0.0, bh - 1)
      val x1 = ((right - offX) / scale).coerceIn(x0 + 1, bw)
      val y1 = ((bottom - offY) / scale).coerceIn(y0 + 1, bh)
      val crop = Bitmap.createBitmap(src, x0.roundToInt(), y0.roundToInt(), (x1 - x0).roundToInt().coerceAtLeast(1), (y1 - y0).roundToInt().coerceAtLeast(1))

      val out = File(context.cacheDir, "czytnik-crop-${System.currentTimeMillis()}.jpg")
      FileOutputStream(out).use { crop.compress(Bitmap.CompressFormat.JPEG, 95, it) }

      var b64: String? = null
      if (maxSide > 0) {
        val k = min(1.0, maxSide.toDouble() / max(crop.width, crop.height))
        val small = if (k < 1.0) Bitmap.createScaledBitmap(crop, (crop.width * k).roundToInt(), (crop.height * k).roundToInt(), true) else crop
        val bytes = ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, 90, bytes)
        b64 = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
      }
      return@AsyncFunction mapOf("uri" to Uri.fromFile(out).toString(), "width" to crop.width, "height" to crop.height, "base64" to b64)
    }

    // Stores a comic page photo upright (max 3000 px) in the app's private storage.
    AsyncFunction("savePage") { srcUri: String, comicId: String, name: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val bmp = upright(context, Uri.parse(srcUri))
      val k = min(1.0, 3000.0 / max(bmp.width, bmp.height))
      val page = if (k < 1.0) Bitmap.createScaledBitmap(bmp, (bmp.width * k).roundToInt(), (bmp.height * k).roundToInt(), true) else bmp
      val dir = File(context.filesDir, "comics/" + comicId.filter { it.isLetterOrDigit() || it == '-' }).apply { mkdirs() }
      val f = File(dir, name.filter { it.isLetterOrDigit() || it == '-' } + ".jpg")
      FileOutputStream(f).use { page.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      return@AsyncFunction mapOf("uri" to Uri.fromFile(f).toString(), "width" to page.width, "height" to page.height)
    }

    AsyncFunction("deleteComic") { comicId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      File(context.filesDir, "comics/" + comicId.filter { it.isLetterOrDigit() || it == '-' }).deleteRecursively()
    }

    // Paints white over finger strokes (the "eraser"), so OCR and Claude ignore that part of the photo.
    // points = x,y pairs in image pixels for all strokes in a row; counts = points per stroke.
    // The result is a new file next to the source; a source inside the app's own storage is replaced.
    AsyncFunction("erase") { uri: String, points: List<Double>, counts: List<Int>, brush: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val srcPath = Uri.parse(uri).path ?: throw IllegalArgumentException("Not a file: $uri")
      val src = File(srcPath)
      val bmp = BitmapFactory.decodeFile(srcPath, BitmapFactory.Options().apply { inMutable = true })
        ?: throw IllegalArgumentException("Cannot decode image")
      val canvas = Canvas(bmp)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = brush.toFloat()
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }
      val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
      var i = 0
      for (n in counts) {
        if (n <= 0 || (i + n) * 2 > points.size) break
        if (n == 1) {
          canvas.drawCircle(points[i * 2].toFloat(), points[i * 2 + 1].toFloat(), brush.toFloat() / 2, dot)
        } else {
          val path = Path()
          path.moveTo(points[i * 2].toFloat(), points[i * 2 + 1].toFloat())
          for (j in 1 until n) path.lineTo(points[(i + j) * 2].toFloat(), points[(i + j) * 2 + 1].toFloat())
          canvas.drawPath(path, paint)
        }
        i += n
      }
      val dir = src.parentFile ?: context.cacheDir
      val out = File(dir, src.nameWithoutExtension.substringBefore("-e") + "-e" + System.currentTimeMillis().toString(36) + ".jpg")
      FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      if (src.absolutePath.startsWith(context.filesDir.absolutePath)) src.delete()
      return@AsyncFunction mapOf("uri" to Uri.fromFile(out).toString(), "width" to bmp.width, "height" to bmp.height)
    }

    // Straightens a tilted page photo: the tilt is the one PanelCutter finds from the gutters
    // (up to ±4°); the photo is turned back and saved next to the source (an app-owned source is
    // replaced). angle = 0 means it was already straight and nothing was written.
    AsyncFunction("straighten") { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val srcPath = Uri.parse(uri).path ?: throw IllegalArgumentException("Not a file: $uri")
      val src = BitmapFactory.decodeFile(srcPath) ?: throw IllegalArgumentException("Cannot decode image")
      val k = min(1.0, 700.0 / max(src.width, src.height))
      val w = max(1, (src.width * k).roundToInt())
      val h = max(1, (src.height * k).roundToInt())
      val small = Bitmap.createScaledBitmap(src, w, h, true)
      val px = IntArray(w * h)
      small.getPixels(px, 0, w, 0, 0, w, h)
      val lum = IntArray(w * h) { i ->
        val c = px[i]
        (((c shr 16) and 0xff) * 299 + ((c shr 8) and 0xff) * 587 + (c and 0xff) * 114) / 1000
      }
      val angle = PanelCutter.skewOf(lum, w, h)
      if (angle == 0.0) {
        return@AsyncFunction mapOf("uri" to uri, "width" to src.width, "height" to src.height, "angle" to 0.0)
      }
      val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(out)
      canvas.drawColor(Color.WHITE)
      val m = Matrix().apply { setRotate((-angle).toFloat(), src.width / 2f, src.height / 2f) }
      canvas.drawBitmap(src, m, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
      val srcFile = File(srcPath)
      val dir = srcFile.parentFile ?: context.cacheDir
      val f = File(dir, srcFile.nameWithoutExtension.substringBefore("-") + "-s" + System.currentTimeMillis().toString(36) + ".jpg")
      FileOutputStream(f).use { out.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      if (srcFile.absolutePath.startsWith(context.filesDir.absolutePath)) srcFile.delete()
      return@AsyncFunction mapOf("uri" to Uri.fromFile(f).toString(), "width" to out.width, "height" to out.height, "angle" to angle)
    }

    // Comic panels in reading order, as boxes in image pixels (see PanelCutter).
    // texts: boxes of recognised text as [left, top, width, height, ...] in image pixels (their bubbles may cross gutters)
    AsyncFunction("detectPanels") { uri: String, texts: List<Double> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val src = upright(context, Uri.parse(uri))
      // fine enough that thin panel borders stay unbroken
      val k = min(1.0, 900.0 / max(src.width, src.height))
      val w = max(1, (src.width * k).roundToInt())
      val h = max(1, (src.height * k).roundToInt())
      val small = Bitmap.createScaledBitmap(src, w, h, true)
      val px = IntArray(w * h)
      small.getPixels(px, 0, w, 0, 0, w, h)
      val lum = IntArray(w * h) { i ->
        val c = px[i]
        (((c shr 16) and 0xff) * 299 + ((c shr 8) and 0xff) * 587 + (c and 0xff) * 114) / 1000
      }
      val boxes = texts.chunked(4).filter { it.size == 4 }.map { b ->
        intArrayOf((b[0] * k).roundToInt(), (b[1] * k).roundToInt(), ((b[0] + b[2]) * k).roundToInt(), ((b[1] + b[3]) * k).roundToInt())
      }
      return@AsyncFunction PanelCutter.cut(lum, w, h, boxes).map { r ->
        mapOf(
          "left" to (r[0] / k).roundToInt(), "top" to (r[1] / k).roundToInt(),
          "width" to ((r[2] - r[0]) / k).roundToInt(), "height" to ((r[3] - r[1]) / k).roundToInt(),
        )
      }
    }

    // Text from an image file with positions: one entry per ML Kit block (a paragraph or a comic
    // bubble), lines joined into running text, plus each word's box in image pixels.
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
          val blocks = result.textBlocks.mapNotNull { block ->
            val sb = StringBuilder()
            val words = mutableListOf<Map<String, Any>>()
            for (line in block.lines) {
              val t = line.text.trim()
              if (t.isEmpty()) continue
              if (sb.isEmpty()) sb.append(t)
              else if (sb.endsWith("-")) { sb.setLength(sb.length - 1); sb.append(t) }
              else sb.append(' ').append(t)
              for (el in line.elements) {
                val r = el.boundingBox ?: continue
                words.add(mapOf("text" to el.text, "left" to r.left, "top" to r.top, "width" to r.width(), "height" to r.height()))
              }
            }
            val r = block.boundingBox
            if (sb.isBlank() || r == null) null
            else mapOf("text" to sb.toString(), "left" to r.left, "top" to r.top, "width" to r.width(), "height" to r.height(), "words" to words)
          }
          promise.resolve(mapOf("width" to image.width, "height" to image.height, "blocks" to blocks))
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

  // Decodes the image and applies its EXIF rotation so width/height match what the user saw.
  private fun upright(context: android.content.Context, uri: Uri): Bitmap {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    // keep memory bounded on 50+ MP sensors; 4000 px is plenty for small print
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 4000) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
      ?: throw IllegalArgumentException("Cannot decode image")
    val orientation = resolver.openInputStream(uri).use { s ->
      if (s == null) ExifInterface.ORIENTATION_NORMAL
      else ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      else -> return bmp
    }
    val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (rotated !== bmp) bmp.recycle()
    return rotated
  }
}
