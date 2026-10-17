using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>V8Sort reproduces V8's TimSort order, including inconsistent near-tie comparators (scripts/parity/v8sort.mjs).</summary>
public class V8SortParityTests
{
    [Fact]
    public void OrderMatchesV8()
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "v8sort.json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        var cases = JsonDocument.Parse(reader.ReadToEnd()).RootElement;
        int checkedCases = 0;
        foreach (var c in cases.EnumerateArray())
        {
            int mode = c.GetProperty("mode").GetInt32();
            var items = c.GetProperty("items").EnumerateArray().Select((p, i) => (I: i, X: p[0].GetDouble(), Z: p[1].GetDouble())).ToList();
            const double fx = 0, fz = 14.2;
            Func<(int I, double X, double Z), (int I, double X, double Z), double> cmp = mode == 0
                ? (a, b) => (a.X - fx) * (a.X - fx) + (a.Z - fz) * (a.Z - fz) - (b.X - fx) * (b.X - fx) - (b.Z - fz) * (b.Z - fz)
                : mode == 1 ? (a, b) => JsMath.Hypot(a.X, a.Z - fz) - JsMath.Hypot(b.X, b.Z - fz)
                : (a, b) => a.X * .1 + a.Z * .3 - b.X * .1 - b.Z * .3;
            V8Sort.Sort(items, cmp);
            Assert.Equal(c.GetProperty("order").EnumerateArray().Select(v => v.GetInt32()).ToList(), items.Select(p => p.I).ToList());
            checkedCases++;
        }
        Assert.Equal(60, checkedCases);
    }
}
