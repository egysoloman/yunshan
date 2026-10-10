using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Yunshan.Core;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Bit-for-bit agreement with V8 (Node 22) over the input set of
/// scripts/parity/math.mjs; digests are in Parity/math-v8.json.</summary>
public class JsMathParityTests
{
    static IEnumerable<double[]> Inputs(int count)
    {
        double[] special = { 0, -0.0, 1, -1, .5, -.5, 1.5, 2.5, -2.5, 0.49999999999999994, Math.PI / 4, Math.PI / 2, Math.PI, 1e-300, 5e-324, 1e21, 1e-7, 123456789.125, 709.78, -745.2, 1e308, double.PositiveInfinity, double.NegativeInfinity, double.NaN };
        foreach (var s in special) foreach (var t in special) yield return new[] { s, t, s };
        uint seed = 0x9E3779B9;
        double Next() { seed = unchecked(seed * 1664525u + 1013904223u); return seed / 4294967296.0; }
        double[] scales = { 1, 3.2, 10, 640, 1e3, 1e5, 1e9, 1e-3 };
        for (int i = 0; i < count; i++)
        {
            double scale = scales[i % 8];
            double x = (Next() * 2 - 1) * scale, y = (Next() * 2 - 1) * scale * (i % 3 != 0 ? 1 : .01), e = (Next() * 2 - 1) * 50;
            yield return new[] { x, y, e };
        }
    }

    static readonly JsonElement Expected = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "math-v8.json"))).RootElement.GetProperty("digests");

    static string Digest(Func<double[], double> fn)
    {
        using var sha = SHA256.Create();
        var bytes = new List<byte>(8 * 200600);
        // JavaScript cannot observe NaN payloads; V8 writes the canonical quiet NaN.
        foreach (var input in Inputs(200000)) { double r = fn(input); bytes.AddRange(BitConverter.GetBytes(double.IsNaN(r) ? BitConverter.Int64BitsToDouble(0x7FF8000000000000) : r)); }
        return Convert.ToHexString(sha.ComputeHash(bytes.ToArray())).ToLowerInvariant();
    }

    [Theory]
    [InlineData("sin")] [InlineData("cos")] [InlineData("exp")] [InlineData("atan2")]
    [InlineData("hypot2")] [InlineData("hypot3")] [InlineData("round")] [InlineData("max")] [InlineData("min")]
    public void MatchesV8(string name)
    {
        Func<double[], double> fn = name switch
        {
            "sin" => v => JsMath.Sin(v[0]), "cos" => v => JsMath.Cos(v[0]), "exp" => v => JsMath.Exp(v[2]),
            "atan2" => v => JsMath.Atan2(v[1], v[0]), "hypot2" => v => JsMath.Hypot(v[0], v[1]), "hypot3" => v => JsMath.Hypot(v[0], v[1], v[2]),
            "round" => v => JsMath.Round(v[0] * (v[1] > 0 ? 1 : 1 / 64.0)), "max" => v => JsMath.Max(v[0], v[1]), "min" => v => JsMath.Min(v[0], v[1]),
            _ => throw new ArgumentException(name),
        };
        Assert.Equal(Expected.GetProperty(name).GetString(), Digest(fn));
    }

    [Fact]
    public void NumberToStringMatchesV8()
    {
        var text = new StringBuilder();
        foreach (var v in Inputs(200000)) text.Append(JsMath.ToJsString(v[0])).Append('|').Append(JsMath.ToJsString(v[0] * v[1])).Append('|').Append(JsMath.ToJsString(JsMath.Round(v[0] * 5) / 5)).Append('\n');
        using var sha = SHA256.Create();
        Assert.Equal(Expected.GetProperty("toString").GetString(), Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(text.ToString()))).ToLowerInvariant());
    }
}
