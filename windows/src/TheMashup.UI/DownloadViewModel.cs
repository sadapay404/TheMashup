using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows.Input;
using TheMashup.Core;

namespace TheMashup.UI;

public sealed class DownloadViewModel : INotifyPropertyChanged
{
    private readonly IDownloadService _service;
    private string _status = "Downloads are ready.";

    public DownloadViewModel(IDownloadService service)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
        RefreshCommand = new ActionCommand(() => _ = LoadAsync());
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public ObservableCollection<DownloadRowViewModel> Jobs { get; } = [];
    public string Status
    {
        get => _status;
        internal set
        {
            if (_status == value) return;
            _status = value;
            Notify(nameof(Status));
        }
    }
    public bool HasJobs => Jobs.Count > 0;
    public string JobCountText => Jobs.Count == 1 ? "1 download" : $"{Jobs.Count} downloads";
    public ICommand RefreshCommand { get; }

    public async Task LoadAsync()
    {
        try
        {
            var jobs = await _service.ListAsync(CancellationToken.None);
            Jobs.Clear();
            foreach (var job in jobs)
                Jobs.Add(new DownloadRowViewModel(job, this));
            Status = jobs.Count == 0 ? "No downloads yet." : "Downloads are ready.";
        }
        catch (Exception ex)
        {
            Jobs.Clear();
            Status = ex is DownloadProviderException ? ex.Message : "Downloads could not be loaded. Please retry.";
        }
        Notify(nameof(HasJobs), nameof(JobCountText));
    }

    public async Task<IReadOnlyList<DownloadJob>> StartBatchAsync(IEnumerable<CatalogTrack> tracks,
        string container, string quality)
    {
        var usable = tracks.Where(track => track.IsUsable).ToArray();
        if (usable.Length == 0)
        {
            Status = "Nothing to download.";
            return [];
        }
        try
        {
            var jobs = await _service.StartBatchAsync(usable, container, quality, CancellationToken.None);
            await LoadAsync();
            Status = jobs.Count == 0 ? "Download started." : $"Started {jobs.Count} download(s).";
            return jobs;
        }
        catch (Exception ex)
        {
            Status = ex is DownloadProviderException ? ex.Message : "Downloads could not start. Please try again.";
            return [];
        }
    }

    internal async Task CancelAsync(DownloadRowViewModel row)
    {
        try
        {
            var job = await _service.CancelAsync(row.Id, CancellationToken.None);
            row.Update(job);
            Status = "Download cancelled.";
        }
        catch (Exception ex)
        {
            Status = ex is DownloadProviderException ? ex.Message : "This download could not be cancelled.";
        }
    }

    private void Notify(params string[] names)
    {
        foreach (var name in names)
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

public sealed class DownloadRowViewModel : INotifyPropertyChanged
{
    private readonly DownloadViewModel _owner;

    public DownloadRowViewModel(DownloadJob job, DownloadViewModel owner)
    {
        _owner = owner;
        Update(job);
        CancelCommand = new ActionCommand(() => _ = owner.CancelAsync(this));
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public string Id { get; private set; } = "";
    public string Title { get; private set; } = "";
    public string Container { get; private set; } = "";
    public string Quality { get; private set; } = "";
    public string StatusText { get; private set; } = "";
    public string ProgressText { get; private set; } = "";
    public bool CanCancel => StatusText is "Queued" or "Downloading" or "Processing";
    public ICommand CancelCommand { get; }

    public void Update(DownloadJob job)
    {
        Id = job.Id;
        Title = job.Title;
        Container = job.Container;
        Quality = job.Quality;
        StatusText = job.Status;
        ProgressText = job.Progress > 0 ? $"{job.Progress}%" : "";
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Id)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Title)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Container)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Quality)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StatusText)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ProgressText)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanCancel)));
    }
}
