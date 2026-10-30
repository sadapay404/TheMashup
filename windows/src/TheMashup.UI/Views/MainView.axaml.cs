using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;

namespace TheMashup.UI.Views;

public partial class MainView : UserControl
{
    public MainView()
    {
        InitializeComponent();
        SizeChanged += (_, args) => (DataContext as ShellViewModel)?.UpdateWidth(args.NewSize.Width);
        DataContextChanged += (_, _) => (DataContext as ShellViewModel)?.UpdateWidth(Bounds.Width);
        var surface = this.FindControl<ContentControl>("VideoSurface");
        if (surface is not null && App.VideoSurfaceFactory is not null) surface.Content = App.VideoSurfaceFactory();
        LayoutUpdated += (_, _) => UpdateVideoBounds();
        DetachedFromVisualTree += (_, _) => App.VideoBoundsChanged?.Invoke(0, 0, 0, 0, false);
    }

    private Rect _lastVideoBounds;
    private bool _lastVideoVisible;
    private void UpdateVideoBounds()
    {
        if (App.VideoBoundsChanged is null) return;
        var surface = this.FindControl<ContentControl>("VideoSurface");
        var point = surface?.TranslatePoint(new Point(0, 0), this);
        var visible = surface?.IsEffectivelyVisible == true && point is not null &&
            surface.Bounds.Width > 0 && surface.Bounds.Height > 0;
        var rect = visible ? new Rect(point!.Value, surface!.Bounds.Size) : default;
        if (rect == _lastVideoBounds && visible == _lastVideoVisible) return;
        _lastVideoBounds = rect; _lastVideoVisible = visible;
        App.VideoBoundsChanged(rect.X, rect.Y, rect.Width, rect.Height, visible);
    }

    private void OnSearchKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || DataContext is not ShellViewModel shell) return;
        shell.Search.SubmitCommand.Execute(null);
        e.Handled = true;
    }
}
