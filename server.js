import express from "express";
import { processImage } from "./service/processImageWithPositionService.js";
import bodyParser from "body-parser";
import archiver from "archiver";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.static("public"));

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
        "./public/logo_white.svg",
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

app.listen(3000, () => console.log("🖼️ App at http://localhost:3000"));
