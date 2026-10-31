using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/characters.ts: looks, rest poses, body skin joints, mounts, poses and garment joints.</summary>
public class StudioCharacterParityTests
{
    static Dictionary<string, Dictionary<string, double[]>> Ports()
    {
        var root = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "studio-assets.json"))).RootElement;
        return root.GetProperty("assets").EnumerateArray().ToDictionary(a => a.GetProperty("id").GetString()!, a =>
            a.TryGetProperty("ports", out var ports) ? ports.EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!, p => p.GetProperty("position").EnumerateArray().Select(v => v.GetDouble()).ToArray()) : new Dictionary<string, double[]>());
    }
    static Dictionary<string, double[]> Bounds(string key) => StudioLayoutParityTests.Manifest().ToDictionary(p => p.Key, p => key == "min" ? p.Value.Min : p.Value.Max);
    static object Vec(double[] v) => v.Select(x => (object)x).ToList();
    static void Same(JsonElement expected, object actual, string what) { var a = Write(actual); var e = expected.GetRawText(); Assert.True(e == a, $"{what}: expected {e[..Math.Min(400, e.Length)]} actual {a[..Math.Min(400, a.Length)]}"); }

    [Fact]
    public void CharactersMatchTypeScript()
    {
        string text;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "characters-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) text = reader.ReadToEnd();
        var root = JsonDocument.Parse(text).RootElement; var ports = Ports(); var min = Bounds("min"); var max = Bounds("max");
        foreach (var row in root.GetProperty("looks").EnumerateArray())
        {
            var c = row.GetProperty("context");
            var context = new CharacterContext { Age = c.GetProperty("age").GetDouble(), Role = c.GetProperty("role").GetString()!, State = c.GetProperty("state").GetString()!, Hour = c.GetProperty("hour").GetDouble(), Weather = c.GetProperty("weather").GetString()!,
                Health = c.GetProperty("health").GetDouble(), Pregnant = c.GetProperty("pregnant").GetBoolean(), Ceremony = c.GetProperty("ceremony").ValueKind == JsonValueKind.Null ? null : c.GetProperty("ceremony").GetString(), InfantNearby = c.GetProperty("infantNearby").GetBoolean() };
            var look = StudioCharacterLook.Look(row.GetProperty("id").GetString()!, context);
            Same(row.GetProperty("look"), new Obj().Put("rig", look.Rig).Put("body", look.Body).Put("parts", look.Parts.Select(p => (object)new Obj().Put("asset", p.Asset).Put("mount", p.Mount)).ToList()), "look " + row.GetProperty("id").GetString());
        }
        foreach (var body in root.GetProperty("bodies").EnumerateArray())
        {
            string id = body.GetProperty("id").GetString()!; var bp = ports[id]; var rest = StudioCharacterLook.Rest(bp);
            var restObj = new Obj(); foreach (var pair in rest) restObj.Put(pair.Key, Vec(pair.Value)); Same(body.GetProperty("rest"), restObj, id + " rest");
            var joints = new List<object>(); double[] lo = min[id], hi = max[id];
            for (int iy = 0; iy <= 30; iy++) for (int ix = 0; ix <= 12; ix++) joints.Add(StudioCharacterLook.BodyJoint(lo[0] + (hi[0] - lo[0]) * ix / 12, lo[1] + (hi[1] - lo[1]) * iy / 30, bp));
            Same(body.GetProperty("joints"), joints, id + " body joints");
            var mounts = new List<object>();
            foreach (var mount in new[] { "neck", "wrist-left", "wrist-right", "ankle-left", "grip-right", "grip-left", "back", "satchel", "waist", "badge", "belly" })
                foreach (var part in new[] { "CHAR-180", "CHAR-178", "CHAR-142", "CHAR-147", "CHAR-148", "CHAR-149", "CHAR-150", "CHAR-189" })
                { var (joint, offset) = StudioCharacterLook.MountOffset(mount, rest, bp, ports[part], min[part], max[part]); mounts.Add(new Obj().Put("mount", mount).Put("part", part).Put("joint", joint).Put("offset", Vec(offset))); }
            Same(body.GetProperty("mounts"), mounts, id + " mounts");
        }
        foreach (var pose in root.GetProperty("poses").EnumerateArray())
        {
            var joints = StudioCharacterLook.Pose(pose.GetProperty("phase").GetDouble(), pose.GetProperty("walking").GetBoolean(), pose.GetProperty("seated").GetBoolean(), pose.GetProperty("dead").GetBoolean());
            var obj = new Obj(); foreach (var pair in joints) obj.Put(pair.Key, new Obj().Put("x", pair.Value.X).Put("z", pair.Value.Z)); Same(pose.GetProperty("joints"), obj, "pose");
        }
        foreach (var g in root.GetProperty("garments").EnumerateArray()) Assert.Equal(g.GetProperty("joint").GetString(), StudioCharacterLook.GarmentJoint(g.GetProperty("name").GetString()!));
        Assert.Equal(300, root.GetProperty("looks").GetArrayLength());
    }
}
