// Signatures of the UnityEditor members used by Assets/Yunshan/Editor, for a
// compile-only check outside Unity. Bodies are never executed.
using System;
namespace UnityEditor
{
    [AttributeUsage(AttributeTargets.Method)] public sealed class MenuItem : Attribute { public MenuItem(string itemName) { } }
    public static class AssetDatabase { public static void Refresh() { } }
    public static class EditorUtility { public static bool DisplayDialog(string title, string message, string ok) => true; }
}
namespace UnityEditor.Build
{
    public interface IOrderedCallback { int callbackOrder { get; } }
    public interface IPreprocessBuildWithReport : IOrderedCallback { void OnPreprocessBuild(Reporting.BuildReport report); }
    public class BuildFailedException : Exception { public BuildFailedException(string message) : base(message) { } }
}
namespace UnityEditor.Build.Reporting { public sealed class BuildReport { } }
