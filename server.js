import express from "express";
import { processImage } from "./service/processImageWithPositionService.js";
import bodyParser from "body-parser";
import archiver from "archiver";
import multer from "multer";
import sharp from "sharp";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.static("public"));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

app.post("/generate", async (req, res) => {
  const { left, top, screenWidth, screenHeight, logoWidth, images } = req.body;

  if (!images || !images.length) {
    return res.status(400).send("No images provided");
  }

  try {
    const outputFiles = [];
    const timestamp = Date.now();

    // Process images in memory
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (!image.startsWith("data:image")) {
        return res
          .status(400)
          .send(`Invalid base64 image data for image ${i + 1}`);
      }

      const matches = image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).send(`Invalid base64 format for image ${i + 1}`);
      }

      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");

      const outputBase64 = await processImage(
        buffer,
        "./public/logo.png",
        left,
        top,
        screenWidth,
        screenHeight,
        logoWidth
      );
      outputFiles.push(`data:image/webp;base64,${outputBase64}`);
    }

    // Create ZIP file in memory
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks = [];
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("error", (err) => {
      console.error("ZIP creation error:", err);
      res.status(500).send(`Error creating ZIP: ${err.message}`);
    });

    for (let i = 0; i < outputFiles.length; i++) {
      const base64Data = outputFiles[i].split(",")[1];
      archive.append(Buffer.from(base64Data, "base64"), {
        name: `generated_image_${i + 1}.webp`,
      });
    }

    await archive.finalize();
    const zipBuffer = Buffer.concat(chunks);
    const zipBase64 = zipBuffer.toString("base64");

    console.log(
      `Images and ZIP created in memory, image count: ${outputFiles.length}, ZIP size: ${zipBuffer.length} bytes`
    );

    res.status(200).json({
      message: "Images generated",
      files: outputFiles,
      zipFile: `data:application/zip;base64,${zipBase64}`,
    });
  } catch (error) {
    console.error("Error processing images:", error);
    res.status(500).send(`Error processing images: ${error.message}`);
  }
});

// Function to calculate watermark position
function calculatePosition(
  position,
  mainWidth,
  mainHeight,
  logoWidth,
  logoHeight,
  customX = null,
  customY = null
) {
  const margin = 20; // 20px margin from edges

  // Handle custom position with percentage coordinates
  if (
    position.toLowerCase() === "custom" &&
    customX !== null &&
    customY !== null
  ) {
    const left = Math.round(parseFloat(customX) * mainWidth);
    const top = Math.round(parseFloat(customY) * mainHeight);

    // Ensure the logo stays within bounds with margin
    const constrainedLeft = Math.max(
      margin,
      Math.min(left, mainWidth - logoWidth - margin)
    );
    const constrainedTop = Math.max(
      margin,
      Math.min(top, mainHeight - logoHeight - margin)
    );

    return { left: constrainedLeft, top: constrainedTop };
  }

  // Handle preset positions
  switch (position.toLowerCase()) {
    case "top-left":
      return { left: margin, top: margin };
    case "top-right":
      return { left: mainWidth - logoWidth - margin, top: margin };
    case "top-center":
      return { left: Math.floor((mainWidth - logoWidth) / 2), top: margin };
    case "bottom-left":
      return { left: margin, top: mainHeight - logoHeight - margin };
    case "bottom-right":
      return {
        left: mainWidth - logoWidth - margin,
        top: mainHeight - logoHeight - margin,
      };
    case "bottom-center":
      return {
        left: Math.floor((mainWidth - logoWidth) / 2),
        top: mainHeight - logoHeight - margin,
      };
    case "center":
      return {
        left: Math.floor((mainWidth - logoWidth) / 2),
        top: Math.floor((mainHeight - logoHeight) / 2),
      };
    case "center-left":
      return { left: margin, top: Math.floor((mainHeight - logoHeight) / 2) };
    case "center-right":
      return {
        left: mainWidth - logoWidth - margin,
        top: Math.floor((mainHeight - logoHeight) / 2),
      };
    default:
      throw new Error(
        `Unsupported position: ${position}. Supported positions: top-left, top-right, top-center, bottom-left, bottom-right, bottom-center, center, center-left, center-right, custom`
      );
  }
}

// POST /watermark route
app.post(
  "/watermark",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "logoImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // Validate required files
      if (!req.files || !req.files.mainImage || !req.files.logoImage) {
        return res.status(400).json({
          error: "Both mainImage and logoImage files are required",
        });
      }

      const mainImageFile = req.files.mainImage[0];
      const logoImageFile = req.files.logoImage[0];
      const position = req.body.position || "bottom-right";
      const customX = req.body.customX || null;
      const customY = req.body.customY || null;

      // Validate image formats
      if (
        !mainImageFile.mimetype.startsWith("image/") ||
        !logoImageFile.mimetype.startsWith("image/")
      ) {
        return res.status(400).json({
          error: "Invalid image format. Only image files are allowed.",
        });
      }

      // Get main image dimensions
      const mainImage = sharp(mainImageFile.buffer);
      const { width: mainWidth, height: mainHeight } =
        await mainImage.metadata();

      if (!mainWidth || !mainHeight) {
        return res.status(400).json({
          error: "Unable to read main image dimensions",
        });
      }

      // Calculate logo size (15% of main image width)
      const logoTargetWidth = Math.round(mainWidth * 0.15);

      // Resize logo while maintaining aspect ratio
      const logoImage = sharp(logoImageFile.buffer);
      const resizedLogo = await logoImage
        .resize({ width: logoTargetWidth, withoutEnlargement: true })
        .png() // Convert to PNG to preserve alpha channel
        .toBuffer();

      // Get resized logo dimensions
      const { width: logoWidth, height: logoHeight } = await sharp(
        resizedLogo
      ).metadata();

      // Calculate watermark position
      const { left, top } = calculatePosition(
        position,
        mainWidth,
        mainHeight,
        logoWidth,
        logoHeight,
        customX,
        customY
      );

      // Apply watermark with proper alpha blending
      const watermarkedBuffer = await mainImage
        .composite([
          {
            input: resizedLogo,
            left: left,
            top: top,
            blend: "over", // Proper alpha blending
          },
        ])
        .png({ quality: 95, compressionLevel: 6 }) // High quality PNG output
        .toBuffer();

      // Set appropriate headers and stream the result
      res.set({
        "Content-Type": "image/png",
        "Content-Length": watermarkedBuffer.length,
        "Cache-Control": "no-cache",
      });

      res.send(watermarkedBuffer);
    } catch (error) {
      console.error("Watermarking error:", error);

      if (error.message.includes("Unsupported position")) {
        return res.status(400).json({
          error: error.message,
        });
      }

      if (error.message.includes("Only image files are allowed")) {
        return res.status(400).json({
          error: error.message,
        });
      }

      res.status(500).json({
        error: "Internal server error during image processing",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

app.listen(3000, () => console.log("🖼️ App at http://localhost:3000"));
