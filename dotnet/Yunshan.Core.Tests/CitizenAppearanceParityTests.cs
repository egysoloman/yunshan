using System.IO.Compression;
using System.Text;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

public class CitizenAppearanceParityTests
{
    [Fact]
    public void PartsMatchTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "citizen-appearance.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        string[] roles = { "商人", "工人", "警察", "老师", "学生", "soldier", "official", "官员", "医生", "驾驶员", "卫士", "merchant" };
        double[] ages = { 1, 4, 8, 15, 30, 70 };
        var cases = new List<object>();
        for (int i = 0; i < 240; i++)
        {
            string id = i % 17 == 0 ? $"玩家-{i}" : $"citizen-{i}", role = roles[i % roles.Length];
            double age = ages[i % ages.Length];
            var pose = new CitizenAppearance.Pose { Yaw = 0, Phase = i * .37, Walking = i % 2 == 0, Seated = i % 5 == 0, Dead = i % 7 == 0 };
            bool near = i % 3 != 0;
            var parts = CitizenAppearance.Describe(id, role, age, pose, near).Select(p => (object)new Obj().Put("name", p.Name).Put("position", Vec(p.Position)).Put("size", Vec(p.Size)).Put("color", p.Color)
                .Put("pivot", Vec(p.Pivot)).Put("rotationX", p.RotationX).Put("face", p.Face).Put("garment", (double)p.Garment)).ToList();
            cases.Add(new Obj().Put("id", id).Put("role", role).Put("age", age).Put("near", near)
                .Put("pose", new Obj().Put("yaw", 0d).Put("phase", pose.Phase).Put("walking", pose.Walking).Put("seated", pose.Seated).Put("dead", pose.Dead)).Put("parts", parts));
        }
        var actual = Write(cases);
        Assert.Equal(expected.Length, actual.Length);
        Assert.True(expected == actual, "citizen appearance differs from TypeScript");
    }

    [Fact]
    public void FaceTextureMatchesTypeScript()
    {
        // scripts/parity/face.ts: SHA-256 of createCitizenFaceTexture().image.data
        var bytes = CitizenFaceTexture.Pixels();
        Assert.Equal(CitizenFaceTexture.Width * CitizenFaceTexture.Height * 4, bytes.Length);
        var sha = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
        Assert.Equal("deda18464cd13631e61f9d64b27e1110abdbe1f08db110a0558abf39ccef8832", sha);
    }
}
