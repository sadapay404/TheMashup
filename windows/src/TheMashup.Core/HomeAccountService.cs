namespace TheMashup.Core;

public interface IAccountSignInLauncher
{
    Task<AccountSnapshot> LaunchAsync(CancellationToken cancellationToken);
}

public sealed class UnavailableAccountSignInLauncher : IAccountSignInLauncher
{
    public Task<AccountSnapshot> LaunchAsync(CancellationToken cancellationToken) =>
        Task.FromException<AccountSnapshot>(new HomeProviderException("Account sign-in is not available in this build."));
}
