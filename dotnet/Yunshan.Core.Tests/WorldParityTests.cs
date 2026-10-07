using System.IO.Compression;
using System.Text;
using Yunshan.Core;
using Xunit;
using Xunit.Abstractions;

namespace Yunshan.Core.Tests;

/// <summary>createWorld() in C# must equal the TypeScript reference byte for
/// byte in canonical JSON (scripts/parity/world.ts).</summary>
public class WorldParityTests
{
    readonly ITestOutputHelper output;
    public WorldParityTests(ITestOutputHelper output) => this.output = output;

    static string Reference(string layout)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", $"world-{layout}.json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    [Theory]
    [InlineData("current-v5")]
    [InlineData("current-v6")]
    public void CreateWorldMatchesTypeScript(string layout)
    {
        var expected = Reference(layout);
        var actual = CanonicalJson.Write(CanonicalJson.World(World.CreateWorld(20261001, layout)));
        if (actual != expected)
        {
            int i = 0; while (i < Math.Min(actual.Length, expected.Length) && actual[i] == expected[i]) i++;
            int from = Math.Max(0, i - 200);
            output.WriteLine($"first difference at {i} of {expected.Length}/{actual.Length}");
            output.WriteLine("expected: " + expected.Substring(from, Math.Min(400, expected.Length - from)));
            output.WriteLine("actual:   " + actual.Substring(from, Math.Min(400, actual.Length - from)));
        }
        Assert.True(actual == expected, "canonical world JSON differs from the TypeScript reference");
    }
}
