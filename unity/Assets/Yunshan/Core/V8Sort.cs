// Port of V8's Array.prototype.sort (third_party/v8/builtins/array-sort.tq,
// TimSort with binary insertion and galloping merges). A comparator that is
// not a consistent total order (floating near-ties computed as a − b) makes
// different stable sorts disagree; this reproduces V8's exact comparison
// sequence so ported rendering decisions match the web client bit for bit.
using System;
using System.Collections.Generic;

namespace Yunshan.Core
{
    public static class V8Sort
    {
        const int MinGallopWins = 7;

        public static void Sort<T>(List<T> list, Func<T, T, double> comparefn)
        {
            if (list.Count < 2) return;
            var a = list.ToArray();
            new State<T>(a, comparefn).Run();
            for (int i = 0; i < a.Length; i++) list[i] = a[i];
        }

        sealed class State<T>
        {
            readonly T[] a; readonly Func<T, T, double> cmp;
            readonly List<(int Base, int Length)> runs = new List<(int, int)>();
            int minGallop = MinGallopWins;
            public State(T[] a, Func<T, T, double> cmp) { this.a = a; this.cmp = cmp; }
            // A NaN comparator result counts as 0, as in V8 (ToNumber then < 0 tests).
            double Compare(T x, T y) { double c = cmp(x, y); return double.IsNaN(c) ? 0 : c; }

            static int MinRunLength(int n) { int r = 0; while (n >= 64) { r |= n & 1; n >>= 1; } return n + r; }

            public void Run()
            {
                int remaining = a.Length, low = 0, minRun = MinRunLength(remaining);
                while (remaining != 0)
                {
                    int current = CountAndMakeRun(low, low + remaining);
                    if (current < minRun)
                    {
                        int forced = Math.Min(minRun, remaining);
                        BinaryInsertionSort(low, low + current, low + forced);
                        current = forced;
                    }
                    runs.Add((low, current));
                    MergeCollapse();
                    low += current; remaining -= current;
                }
                MergeForceCollapse();
            }

            int CountAndMakeRun(int lowArg, int high)
            {
                int low = lowArg + 1;
                if (low == high) return 1;
                int runLength = 2;
                T elementLow = a[low], elementLowPre = a[low - 1];
                bool descending = Compare(elementLow, elementLowPre) < 0;
                T previous = elementLow;
                for (int idx = low + 1; idx < high; ++idx)
                {
                    T current = a[idx]; double order = Compare(current, previous);
                    if (descending) { if (order >= 0) break; } else { if (order < 0) break; }
                    previous = current; ++runLength;
                }
                if (descending) Array.Reverse(a, lowArg, runLength);
                return runLength;
            }

            void BinaryInsertionSort(int low, int startArg, int high)
            {
                int start = low == startArg ? startArg + 1 : startArg;
                for (; start < high; ++start)
                {
                    int left = low, right = start; T pivot = a[start];
                    while (left < right) { int mid = left + ((right - left) >> 1); if (Compare(pivot, a[mid]) < 0) right = mid; else left = mid + 1; }
                    for (int p = start; p > left; --p) a[p] = a[p - 1];
                    a[left] = pivot;
                }
            }

            bool InvariantEstablished(int n) => n < 2 || runs[n - 2].Length > runs[n - 1].Length + runs[n].Length;

            void MergeCollapse()
            {
                while (runs.Count > 1)
                {
                    int n = runs.Count - 2;
                    if (!InvariantEstablished(n + 1) || !InvariantEstablished(n)) { if (runs[n - 1].Length < runs[n + 1].Length) --n; MergeAt(n); }
                    else if (runs[n].Length <= runs[n + 1].Length) MergeAt(n);
                    else break;
                }
            }

            void MergeForceCollapse()
            {
                while (runs.Count > 1)
                {
                    int n = runs.Count - 2;
                    if (n > 0 && runs[n - 1].Length < runs[n + 1].Length) --n;
                    MergeAt(n);
                }
            }

            void MergeAt(int i)
            {
                var (baseA, lengthA) = runs[i]; var (baseB, lengthB) = runs[i + 1];
                runs[i] = (baseA, lengthA + lengthB);
                runs.RemoveAt(i + 1);
                T keyRight = a[baseB];
                int k = GallopRight(a, keyRight, baseA, lengthA, 0);
                baseA += k; lengthA -= k;
                if (lengthA == 0) return;
                T keyLeft = a[baseA + lengthA - 1];
                lengthB = GallopLeft(a, keyLeft, baseB, lengthB, lengthB - 1);
                if (lengthB == 0) return;
                if (lengthA <= lengthB) MergeLow(baseA, lengthA, baseB, lengthB); else MergeHigh(baseA, lengthA, baseB, lengthB);
            }

            int GallopLeft(T[] array, T key, int @base, int length, int hint)
            {
                int lastOfs = 0, offset = 1;
                if (Compare(array[@base + hint], key) < 0)
                {
                    int maxOfs = length - hint;
                    while (offset < maxOfs) { if (Compare(array[@base + hint + offset], key) >= 0) break; lastOfs = offset; offset = (offset << 1) + 1; if (offset <= 0) offset = maxOfs; }
                    if (offset > maxOfs) offset = maxOfs;
                    lastOfs += hint; offset += hint;
                }
                else
                {
                    int maxOfs = hint + 1;
                    while (offset < maxOfs) { if (Compare(array[@base + hint - offset], key) < 0) break; lastOfs = offset; offset = (offset << 1) + 1; if (offset <= 0) offset = maxOfs; }
                    if (offset > maxOfs) offset = maxOfs;
                    int tmp = lastOfs; lastOfs = hint - offset; offset = hint - tmp;
                }
                lastOfs++;
                while (lastOfs < offset) { int m = lastOfs + ((offset - lastOfs) >> 1); if (Compare(array[@base + m], key) < 0) lastOfs = m + 1; else offset = m; }
                return offset;
            }

            int GallopRight(T[] array, T key, int @base, int length, int hint)
            {
                int lastOfs = 0, offset = 1;
                if (Compare(key, array[@base + hint]) < 0)
                {
                    int maxOfs = hint + 1;
                    while (offset < maxOfs) { if (Compare(key, array[@base + hint - offset]) >= 0) break; lastOfs = offset; offset = (offset << 1) + 1; if (offset <= 0) offset = maxOfs; }
                    if (offset > maxOfs) offset = maxOfs;
                    int tmp = lastOfs; lastOfs = hint - offset; offset = hint - tmp;
                }
                else
                {
                    int maxOfs = length - hint;
                    while (offset < maxOfs) { if (Compare(key, array[@base + hint + offset]) < 0) break; lastOfs = offset; offset = (offset << 1) + 1; if (offset <= 0) offset = maxOfs; }
                    if (offset > maxOfs) offset = maxOfs;
                    lastOfs += hint; offset += hint;
                }
                lastOfs++;
                while (lastOfs < offset) { int m = lastOfs + ((offset - lastOfs) >> 1); if (Compare(key, array[@base + m]) < 0) offset = m; else lastOfs = m + 1; }
                return offset;
            }

            void MergeLow(int baseA, int lengthA, int baseB, int lengthB)
            {
                var temp = new T[lengthA]; Array.Copy(a, baseA, temp, 0, lengthA);
                int dest = baseA, cursorTemp = 0, cursorB = baseB;
                a[dest++] = a[cursorB++];
                if (--lengthB == 0) goto Succeed;
                if (lengthA == 1) goto CopyB;
                int mg = minGallop;
                while (true)
                {
                    int winsA = 0, winsB = 0;
                    while (true)
                    {
                        if (Compare(a[cursorB], temp[cursorTemp]) < 0)
                        {
                            a[dest++] = a[cursorB++]; ++winsB; --lengthB; winsA = 0;
                            if (lengthB == 0) goto Succeed;
                            if (winsB >= mg) break;
                        }
                        else
                        {
                            a[dest++] = temp[cursorTemp++]; ++winsA; --lengthA; winsB = 0;
                            if (lengthA == 1) goto CopyB;
                            if (winsA >= mg) break;
                        }
                    }
                    ++mg; bool first = true;
                    while (winsA >= MinGallopWins || winsB >= MinGallopWins || first)
                    {
                        first = false;
                        mg = Math.Max(1, mg - 1); minGallop = mg;
                        winsA = GallopRight(temp, a[cursorB], cursorTemp, lengthA, 0);
                        if (winsA > 0)
                        {
                            Array.Copy(temp, cursorTemp, a, dest, winsA); dest += winsA; cursorTemp += winsA; lengthA -= winsA;
                            if (lengthA == 1) goto CopyB;
                            if (lengthA == 0) goto Succeed;
                        }
                        a[dest++] = a[cursorB++];
                        if (--lengthB == 0) goto Succeed;
                        winsB = GallopLeft(a, temp[cursorTemp], cursorB, lengthB, 0);
                        if (winsB > 0)
                        {
                            Array.Copy(a, cursorB, a, dest, winsB); dest += winsB; cursorB += winsB; lengthB -= winsB;
                            if (lengthB == 0) goto Succeed;
                        }
                        a[dest++] = temp[cursorTemp++];
                        if (--lengthA == 1) goto CopyB;
                    }
                    ++mg; minGallop = mg;
                }
            Succeed:
                if (lengthA > 0) Array.Copy(temp, cursorTemp, a, dest, lengthA);
                return;
            CopyB:
                Array.Copy(a, cursorB, a, dest, lengthB);
                a[dest + lengthB] = temp[cursorTemp];
            }

            void MergeHigh(int baseA, int lengthA, int baseB, int lengthB)
            {
                var temp = new T[lengthB]; Array.Copy(a, baseB, temp, 0, lengthB);
                int dest = baseB + lengthB - 1, cursorTemp = lengthB - 1, cursorA = baseA + lengthA - 1;
                a[dest--] = a[cursorA--];
                if (--lengthA == 0) goto Succeed;
                if (lengthB == 1) goto CopyA;
                int mg = minGallop;
                while (true)
                {
                    int winsA = 0, winsB = 0;
                    while (true)
                    {
                        if (Compare(temp[cursorTemp], a[cursorA]) < 0)
                        {
                            a[dest--] = a[cursorA--]; ++winsA; --lengthA; winsB = 0;
                            if (lengthA == 0) goto Succeed;
                            if (winsA >= mg) break;
                        }
                        else
                        {
                            a[dest--] = temp[cursorTemp--]; ++winsB; --lengthB; winsA = 0;
                            if (lengthB == 1) goto CopyA;
                            if (winsB >= mg) break;
                        }
                    }
                    ++mg; bool first = true;
                    while (winsA >= MinGallopWins || winsB >= MinGallopWins || first)
                    {
                        first = false;
                        mg = Math.Max(1, mg - 1); minGallop = mg;
                        int k = GallopRight(a, temp[cursorTemp], baseA, lengthA, lengthA - 1);
                        winsA = lengthA - k;
                        if (winsA > 0)
                        {
                            dest -= winsA; cursorA -= winsA;
                            Array.Copy(a, cursorA + 1, a, dest + 1, winsA);
                            lengthA -= winsA;
                            if (lengthA == 0) goto Succeed;
                        }
                        a[dest--] = temp[cursorTemp--];
                        if (--lengthB == 1) goto CopyA;
                        k = GallopLeft(temp, a[cursorA], 0, lengthB, lengthB - 1);
                        winsB = lengthB - k;
                        if (winsB > 0)
                        {
                            dest -= winsB; cursorTemp -= winsB;
                            Array.Copy(temp, cursorTemp + 1, a, dest + 1, winsB);
                            lengthB -= winsB;
                            if (lengthB == 1) goto CopyA;
                            if (lengthB == 0) goto Succeed;
                        }
                        a[dest--] = a[cursorA--];
                        if (--lengthA == 0) goto Succeed;
                    }
                    ++mg; minGallop = mg;
                }
            Succeed:
                if (lengthB > 0) Array.Copy(temp, 0, a, dest - (lengthB - 1), lengthB);
                return;
            CopyA:
                dest -= lengthA; cursorA -= lengthA;
                Array.Copy(a, cursorA + 1, a, dest + 1, lengthA);
                a[dest] = temp[cursorTemp];
            }
        }
    }
}
