using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/network.ts: every network box and segment, call by call.</summary>
public class NetworkStructuresParityTests
{
    sealed class Recorder : INetworkSink
    {
        public readonly StringBuilder Json = new StringBuilder("[");
        bool first = true;
        static string N(double v) => JsMath.ToJsString(v);
        static string S(string s) => s == null ? "null" : "\"" + s + "\"";
        void Add(string row) { if (!first) Json.Append(','); first = false; Json.Append(row); }
        public void Box(string key, double x, double y, double z, double sx, double sy, double sz, string color = null, double rotation = 0, bool roof = false)
            => Add($"[\"b\",{S(key)},{N(x)},{N(y)},{N(z)},{N(sx)},{N(sy)},{N(sz)},{S(color)},{N(rotation)},{(roof ? "true" : "false")}]");
        public void Segment(string key, Vec3 a, Vec3 b, double width, double height, double lift = 0, string color = null)
            => Add($"[\"s\",{S(key)},{N(a.X)},{N(a.Y)},{N(a.Z)},{N(b.X)},{N(b.Y)},{N(b.Z)},{N(width)},{N(height)},{N(lift)},{S(color)}]");
    }

    [Fact]
    public void NetworkMatchesTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "network-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var recorder = new Recorder();
        NetworkStructures.Emit(World.CreateWorld(), recorder, true, true, true, true, true, true, true);
        var actual = recorder.Json.Append(']').ToString();
        if (expected != actual)
        {
            int i = 0; while (i < Math.Min(expected.Length, actual.Length) && expected[i] == actual[i]) i++;
            Assert.Fail($"network differs at {i}/{expected.Length}: expected …{expected.Substring(Math.Max(0, i - 160), Math.Min(320, expected.Length - Math.Max(0, i - 160)))}… actual …{actual.Substring(Math.Max(0, i - 160), Math.Min(320, actual.Length - Math.Max(0, i - 160)))}…");
        }
    }
}
