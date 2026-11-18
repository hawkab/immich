class DeletionPolicy {
  final bool Function() _keepCopiesIndependent;

  const DeletionPolicy({this._keepCopiesIndependent = _independentByDefault});

  static bool _independentByDefault() => true;

  bool get keepCopiesIndependent => _keepCopiesIndependent();

  bool get syncDeletions => !keepCopiesIndependent;

  List<String> localTargetsForDelete(List<String> localIds) => keepCopiesIndependent ? const [] : localIds;
}
