/** Approximate a Gaussian with three separable box passes, using sliding sums and bounded image-sized buffers. */
export function soften(source: ImageData, sigma: number): ImageData {
  const { width, height } = source;
  const radius = Math.max(1, Math.round((Math.sqrt(1 + 4 * sigma * sigma) - 1) / 2));
  const divisor = radius * 2 + 1;
  let input = new Uint8ClampedArray(source.data);
  let output = new Uint8ClampedArray(input.length);
  for (let i = 0; i < input.length; i += 4) {
    const alpha = input[i + 3] / 255;
    input[i] *= alpha;
    input[i + 1] *= alpha;
    input[i + 2] *= alpha;
  }
  const pass = (horizontal: boolean) => {
    const count = horizontal ? height : width;
    const length = horizontal ? width : height;
    const step = horizontal ? 4 : width * 4;
    for (let line = 0; line < count; line++) {
      const origin = horizontal ? line * width * 4 : line * 4;
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let position = -radius; position <= radius; position++) {
          sum += input[origin + Math.max(0, Math.min(length - 1, position)) * step + channel];
        }
        for (let position = 0; position < length; position++) {
          output[origin + position * step + channel] = sum / divisor;
          sum +=
            input[origin + Math.min(length - 1, position + radius + 1) * step + channel] -
            input[origin + Math.max(0, position - radius) * step + channel];
        }
      }
    }
    [input, output] = [output, input];
  };
  for (let i = 0; i < 3; i++) {
    pass(true);
    pass(false);
  }
  for (let i = 0; i < input.length; i += 4) {
    const alpha = input[i + 3] / 255;
    if (!(alpha > 0)) {
      continue;
    }

    input[i] /= alpha;
    input[i + 1] /= alpha;
    input[i + 2] /= alpha;
  }
  return new ImageData(input, width, height);
}
