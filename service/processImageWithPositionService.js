import sharp from "sharp";

export async function processImage(
  backgroundBuffer,
  logoFile,
  left,
  top,
  screenWidth,
  screenHeight,
  logoWidth
) {
  const backgroundImage = sharp(backgroundBuffer);
  const { width: imgWidth, height: imgHeight } =
    await backgroundImage.metadata();

  if (!imgWidth || !imgHeight) throw new Error("Invalid background dimensions");

  const margin = 10; // 10px margin on all sides
  const effectiveWidth = imgWidth - 2 * margin; // Account for left and right margins
  const effectiveHeight = imgHeight - 2 * margin; // Account for top and bottom margins

  // Scale position with margins
  const scaledLeft = Math.round((left / screenWidth) * effectiveWidth) + margin;
  const scaledTop = Math.round((top / screenHeight) * effectiveHeight) + margin;

  // Use a fixed scaling ratio (25% of effective width, matching preview)
  const targetLogoWidth = Math.round(effectiveWidth * 0.35); // Adjusted for margins
  const logoHeight = await sharp(logoFile)
    .resize({ width: targetLogoWidth })
    .metadata()
    .then((meta) => meta.height);

  // Ensure logo stays within bounds
  const maxLeft = imgWidth - targetLogoWidth - margin; // Right margin
  const maxTop = imgHeight - logoHeight - margin; // Bottom margin
  const finalLeft = Math.max(margin, Math.min(scaledLeft, maxLeft));
  const finalTop = Math.max(margin, Math.min(scaledTop, maxTop));

  const logoBuffer = await sharp(logoFile)
    .resize({ width: targetLogoWidth })
    .webp()
    .toBuffer();

  const outputBuffer = await backgroundImage
    .composite([{ input: logoBuffer, top: finalTop, left: finalLeft }])
    .webp({ quality: 80 })
    .toBuffer();

  console.log(
    `✅ Processed image with logo at: left=${finalLeft}, top=${finalTop}, logoWidth=${targetLogoWidth}, margins=${margin}px`
  );

  return outputBuffer.toString("base64");
}
