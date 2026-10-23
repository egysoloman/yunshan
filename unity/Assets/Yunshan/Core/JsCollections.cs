// JavaScript collection semantics the simulation relies on.
using System;
using System.Collections.Generic;

namespace Yunshan.Core
{
    public static class Js
    {
        /// <summary>Array.prototype.sort with a numeric comparator: stable;
        /// a NaN comparator result counts as 0 (equal).</summary>
        public static void StableSort<T>(List<T> list, Func<T, T, double> compare)
        {
            if (list.Count < 2) return;
            var buffer = new T[list.Count];
            var items = list.ToArray();
            MergeSort(items, buffer, 0, items.Length, compare);
            for (int i = 0; i < items.Length; i++) list[i] = items[i];
        }

        static void MergeSort<T>(T[] a, T[] tmp, int lo, int hi, Func<T, T, double> compare)
        {
            if (hi - lo < 2) return;
            int mid = (lo + hi) >> 1;
            MergeSort(a, tmp, lo, mid, compare);
            MergeSort(a, tmp, mid, hi, compare);
            int i = lo, j = mid, k = lo;
            while (i < mid && j < hi)
            {
                double c = compare(a[j], a[i]);
                // Take from the right only when strictly smaller: stability.
                if (c < 0) tmp[k++] = a[j++]; else tmp[k++] = a[i++];
            }
            while (i < mid) tmp[k++] = a[i++];
            while (j < hi) tmp[k++] = a[j++];
            Array.Copy(tmp, lo, a, lo, hi - lo);
        }

        /// <summary>JavaScript `a || b` on a comparator term: 0 and NaN are falsy.</summary>
        public static double Or(double a, Func<double> b) => a != 0 && !double.IsNaN(a) ? a : b();

        /// <summary>[...new Set(values)].sort((a, b) =&gt; a - b): SameValueZero
        /// distinct (first of ±0 kept), then a stable ascending sort.</summary>
        public static List<double> DistinctSorted(IEnumerable<double> values)
        {
            var result = new List<double>();
            var seen = new HashSet<long>();
            bool zero = false, nan = false;
            foreach (var v in values)
            {
                if (v == 0) { if (zero) continue; zero = true; }
                else if (double.IsNaN(v)) { if (nan) continue; nan = true; }
                else if (!seen.Add(BitConverter.DoubleToInt64Bits(v))) continue;
                result.Add(v);
            }
            StableSort(result, (a, b) => a - b);
            return result;
        }

        /// <summary>Array.prototype.some / find helpers kept explicit for readability.</summary>
        public static bool Some<T>(IEnumerable<T> items, Func<T, bool> predicate) { foreach (var i in items) if (predicate(i)) return true; return false; }
    }

    /// <summary>Map&lt;string, V&gt; with JavaScript insertion-ordered iteration
    /// (a deleted key that is set again moves to the end).</summary>
    public sealed class OrderedMap<TKey, TValue>
    {
        readonly Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>> index = new Dictionary<TKey, LinkedListNode<KeyValuePair<TKey, TValue>>>();
        readonly LinkedList<KeyValuePair<TKey, TValue>> order = new LinkedList<KeyValuePair<TKey, TValue>>();
        public int Count => index.Count;
        public bool ContainsKey(TKey key) => index.ContainsKey(key);
        public bool TryGetValue(TKey key, out TValue value)
        {
            if (index.TryGetValue(key, out var node)) { value = node.Value.Value; return true; }
            value = default; return false;
        }
        public TValue GetOrDefault(TKey key, TValue fallback = default) => TryGetValue(key, out var v) ? v : fallback;
        public void Set(TKey key, TValue value)
        {
            if (index.TryGetValue(key, out var node)) node.Value = new KeyValuePair<TKey, TValue>(key, value);
            else index[key] = order.AddLast(new KeyValuePair<TKey, TValue>(key, value));
        }
        public bool Delete(TKey key)
        {
            if (!index.TryGetValue(key, out var node)) return false;
            order.Remove(node); index.Remove(key); return true;
        }
        public TKey FirstKey => order.First.Value.Key;
        public IEnumerable<KeyValuePair<TKey, TValue>> Entries { get { for (var n = order.First; n != null;) { var next = n.Next; yield return n.Value; n = next; } } }
        public IEnumerable<TKey> Keys { get { foreach (var e in Entries) yield return e.Key; } }
        public IEnumerable<TValue> Values { get { foreach (var e in Entries) yield return e.Value; } }
        public void Clear() { index.Clear(); order.Clear(); }
    }
}
