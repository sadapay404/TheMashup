using System.ComponentModel;
using System.Runtime.InteropServices;

namespace TheMashup.Desktop;

/// <summary>Minimal DPAPI wrapper used to keep the saved account cookie encrypted at rest.</summary>
internal static class WindowsDpapi
{
    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DATA_BLOB Data, string szDataDescr, ref DATA_BLOB OptionalEntropy, IntPtr Reserved,
        IntPtr PromptStruct, int dwFlags, out DATA_BLOB pbDataProtected);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB Data, out IntPtr pszDataDescr, ref DATA_BLOB OptionalEntropy, IntPtr Reserved,
        IntPtr PromptStruct, int dwFlags, out DATA_BLOB pbDataPlain);

    public static byte[] Protect(byte[] plain)
    {
        var input = new DATA_BLOB { cbData = plain.Length, pbData = Marshal.AllocHGlobal(plain.Length) };
        var empty = new DATA_BLOB();
        try
        {
            Marshal.Copy(plain, 0, input.pbData, plain.Length);
            if (!CryptProtectData(ref input, "TheMashup account snapshot", ref empty, IntPtr.Zero, IntPtr.Zero, 0, out var output))
                throw new Win32Exception();
            return ToArrayAndFree(out output);
        }
        finally
        {
            Marshal.FreeHGlobal(input.pbData);
        }
    }

    public static byte[] Unprotect(byte[] protectedBytes)
    {
        var input = new DATA_BLOB { cbData = protectedBytes.Length, pbData = Marshal.AllocHGlobal(protectedBytes.Length) };
        var empty = new DATA_BLOB();
        try
        {
            Marshal.Copy(protectedBytes, 0, input.pbData, protectedBytes.Length);
            if (!CryptUnprotectData(ref input, out var description, ref empty, IntPtr.Zero, IntPtr.Zero, 0, out var output))
                throw new Win32Exception();
            if (description != IntPtr.Zero) Marshal.FreeHGlobal(description);
            return ToArrayAndFree(out output);
        }
        finally
        {
            Marshal.FreeHGlobal(input.pbData);
        }
    }

    private static byte[] ToArrayAndFree(out DATA_BLOB blob)
    {
        if (blob.cbData <= 0)
        {
            blob = new DATA_BLOB();
            return [];
        }
        var result = new byte[blob.cbData];
        Marshal.Copy(blob.pbData, result, 0, blob.cbData);
        Marshal.FreeHGlobal(blob.pbData);
        blob = new DATA_BLOB();
        return result;
    }
}
