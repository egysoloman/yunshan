using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Yunshan.Core.Host
{
    /// <summary>Minimal JSON reader/writer for the simulation host protocol.
    /// Objects become Dictionary&lt;string, object&gt; (insertion ordered by
    /// parse order is not required), arrays List&lt;object&gt;, numbers double,
    /// plus string, bool and null. No engine or reflection dependency, so it
    /// runs unchanged under IL2CPP.</summary>
    public static class Json
    {
        public static object Parse(string text)
        {
            int i = 0;
            var value = ReadValue(text, ref i);
            SkipSpace(text, ref i);
            if (i != text.Length) throw new FormatException($"JSON 多余字符，位置 {i}");
            return value;
        }

        static void SkipSpace(string s, ref int i) { while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }

        static object ReadValue(string s, ref int i)
        {
            SkipSpace(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON 意外结束");
            char c = s[i];
            if (c == '{')
            {
                var obj = new Dictionary<string, object>(); i++;
                SkipSpace(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return obj; }
                while (true)
                {
                    SkipSpace(s, ref i);
                    if (i >= s.Length || s[i] != '"') throw new FormatException($"JSON 需要键名，位置 {i}");
                    var key = ReadString(s, ref i);
                    SkipSpace(s, ref i);
                    if (i >= s.Length || s[i] != ':') throw new FormatException($"JSON 需要冒号，位置 {i}");
                    i++;
                    obj[key] = ReadValue(s, ref i);
                    SkipSpace(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == '}') { i++; return obj; }
                    throw new FormatException($"JSON 对象未闭合，位置 {i}");
                }
            }
            if (c == '[')
            {
                var list = new List<object>(); i++;
                SkipSpace(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return list; }
                while (true)
                {
                    list.Add(ReadValue(s, ref i));
                    SkipSpace(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == ']') { i++; return list; }
                    throw new FormatException($"JSON 数组未闭合，位置 {i}");
                }
            }
            if (c == '"') return ReadString(s, ref i);
            if (Match(s, ref i, "true")) return true;
            if (Match(s, ref i, "false")) return false;
            if (Match(s, ref i, "null")) return null;
            int start = i;
            if (s[i] == '-') i++;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++;
            if (start == i) throw new FormatException($"JSON 非法字符 '{c}'，位置 {i}");
            return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        static bool Match(string s, ref int i, string word)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) return false;
            i += word.Length; return true;
        }

        static string ReadString(string s, ref int i)
        {
            i++; // opening quote
            var sb = new StringBuilder();
            while (true)
            {
                if (i >= s.Length) throw new FormatException("JSON 字符串未闭合");
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u': sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); i += 4; break;
                    default: throw new FormatException($"JSON 非法转义 \\{e}");
                }
            }
        }

        public static string Write(object value) { var sb = new StringBuilder(); Write(sb, value); return sb.ToString(); }

        public static void Write(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null: sb.Append("null"); break;
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d: sb.Append(double.IsFinite(d) ? JsMath.ToJsString(d) : "null"); break;
                case float f: Write(sb, (double)f); break;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case long n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case Vec3 v: sb.Append("{\"x\":"); Write(sb, v.X); sb.Append(",\"y\":"); Write(sb, v.Y); sb.Append(",\"z\":"); Write(sb, v.Z); sb.Append('}'); break;
                case IDictionary<string, object> obj:
                    sb.Append('{'); bool first = true;
                    foreach (var pair in obj) { if (!first) sb.Append(','); first = false; WriteString(sb, pair.Key); sb.Append(':'); Write(sb, pair.Value); }
                    sb.Append('}'); break;
                case System.Collections.IEnumerable list:
                    sb.Append('['); bool head = true;
                    foreach (var item in list) { if (!head) sb.Append(','); head = false; Write(sb, item); }
                    sb.Append(']'); break;
                default: throw new ArgumentException($"无法写入 JSON 的类型 {value.GetType().Name}");
            }
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)); else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // Typed accessors for parsed values.
        public static Dictionary<string, object> Obj(object o, string key) => (o as Dictionary<string, object>) != null && ((Dictionary<string, object>)o).TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;
        public static List<object> Arr(object o, string key) => (o as Dictionary<string, object>) != null && ((Dictionary<string, object>)o).TryGetValue(key, out var v) ? v as List<object> : null;
        public static string Str(object o, string key, string fallback = null) => (o as Dictionary<string, object>) != null && ((Dictionary<string, object>)o).TryGetValue(key, out var v) && v is string s ? s : fallback;
        public static double Num(object o, string key, double fallback = 0) => (o as Dictionary<string, object>) != null && ((Dictionary<string, object>)o).TryGetValue(key, out var v) && v is double d ? d : fallback;
        public static bool Bool(object o, string key, bool fallback = false) => (o as Dictionary<string, object>) != null && ((Dictionary<string, object>)o).TryGetValue(key, out var v) && v is bool b ? b : fallback;
        public static Vec3 Vec(object o) => o is Dictionary<string, object> p ? new Vec3(Num(p, "x"), Num(p, "y"), Num(p, "z")) : null;
    }
}
