using Yunshan.Core;
using Xunit;
using Xunit.Abstractions;

namespace Yunshan.Core.Tests;

/// <summary>Optional per-sample diagnosis: set YUNSHAN_MATH_DUMP to the
/// output of `node scripts/parity/math.mjs --dump file`.</summary>
public class JsMathDiagnostics
{
    readonly ITestOutputHelper output;
    public JsMathDiagnostics(ITestOutputHelper output) => this.output = output;

    [Fact]
    public void FirstMismatches()
    {
        var path = Environment.GetEnvironmentVariable("YUNSHAN_MATH_DUMP");
        if (string.IsNullOrEmpty(path)) return;
        var b = File.ReadAllBytes(path); var d = new double[b.Length / 8]; Buffer.BlockCopy(b, 0, d, 0, b.Length);
        string[] names = { "sin", "cos", "exp", "atan2", "hypot2", "hypot3", "round", "max", "min" };
        var bad = new int[9]; int row = 0;
        foreach (var v in typeof(JsMathParityTests).GetMethod("Inputs", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!.Invoke(null, new object[] { 200000 }) as IEnumerable<double[]> ?? Array.Empty<double[]>())
        {
            double[] mine = { JsMath.Sin(v[0]), JsMath.Cos(v[0]), JsMath.Exp(v[2]), JsMath.Atan2(v[1], v[0]), JsMath.Hypot(v[0], v[1]), JsMath.Hypot(v[0], v[1], v[2]), JsMath.Round(v[0] * (v[1] > 0 ? 1 : 1 / 64.0)), JsMath.Max(v[0], v[1]), JsMath.Min(v[0], v[1]) };
            for (int k = 0; k < 9; k++)
            {
                double js = d[row * 9 + k];
                if (BitConverter.DoubleToInt64Bits(js) != BitConverter.DoubleToInt64Bits(mine[k]) && bad[k]++ < 3)
                    output.WriteLine($"{names[k]} in=({v[0]:R},{v[1]:R},{v[2]:R}) js={js:R}/{BitConverter.DoubleToInt64Bits(js):X16} cs={mine[k]:R}/{BitConverter.DoubleToInt64Bits(mine[k]):X16}");
            }
            row++;
        }
        output.WriteLine(string.Join(" ", names.Select((n, k) => $"{n}={bad[k]}")));
    }
}
