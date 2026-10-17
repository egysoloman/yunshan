// Port of createCitizenFaceTexture (src/rendering/citizen-appearance.ts):
// six 32×16 face styles side by side (192×16 RGBA). The right half of each
// style is face ink; alpha 255 means "no ink, keep the skin colour".
namespace Yunshan.Core
{
    public static class CitizenFaceTexture
    {
        public const int Width = 32 * 6, Height = 16;

        /// <summary>RGBA bytes, row 0 = texture y 0 (as the web DataTexture).</summary>
        public static byte[] Pixels()
        {
            var data = new byte[Width * Height * 4];
            for (int i = 0; i < data.Length; i++) data[i] = 255;
            void Pixel(int style, int x, int y, int r, int g, int b, int a = 255)
            {
                int offset = (y * Width + style * 32 + x) * 4;
                data[offset] = (byte)r; data[offset + 1] = (byte)g; data[offset + 2] = (byte)b; data[offset + 3] = (byte)a;
            }
            for (int style = 0; style < 6; style++)
            {
                bool elder = style % 3 == 1, child = style % 3 == 2, tense = style >= 3;
                int[] hair = elder ? new[] { 212, 215, 203 } : child ? new[] { 73, 53, 41 } : new[] { 61, 49, 40 };
                foreach (int x in new[] { 21, 26 }) for (int dx = 0; dx < 2; dx++) for (int dy = 0; dy < (elder ? 1 : 2); dy++) Pixel(style, x + dx, 9 + dy, 38, 40, 38);
                for (int x = 23; x < 26; x++) Pixel(style, x, tense ? 3 : 4, 133, 76, 61);
                if (tense) { Pixel(style, 22, 4, 133, 76, 61); Pixel(style, 26, 4, 133, 76, 61); }
                else if (child) { Pixel(style, 22, 5, 133, 76, 61); Pixel(style, 26, 5, 133, 76, 61); }
                for (int y = elder ? 6 : 11; y < 16; y++) for (int x = 16; x < 32; x++) if (y >= 14 || x < (elder ? 19 : 18) || x >= (elder ? 29 : 30)) Pixel(style, x, y, hair[0], hair[1], hair[2], 192);
                foreach (int x in new[] { 21, 26 }) for (int dx = 0; dx < 3; dx++) Pixel(style, x + dx, tense ? 12 - (dx % 2) : 12, elder ? 176 : 59, elder ? 180 : 49, elder ? 168 : 42, 192);
                if (elder) { foreach (int y in new[] { 6, 7 }) { Pixel(style, 20, y, 133, 117, 99); Pixel(style, 28, y, 133, 117, 99); } for (int x = 22; x < 28; x++) Pixel(style, x, 13, 171, 151, 128); }
            }
            return data;
        }
    }
}
