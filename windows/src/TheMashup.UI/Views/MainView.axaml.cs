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
    }

    private void OnSearchKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || DataContext is not ShellViewModel shell) return;
        shell.Search.SubmitCommand.Execute(null);
        e.Handled = true;
    }
}
