from importlib import metadata


class Distribution:
    def __init__(self, version: str) -> None:
        self.version = version


def get_distribution(name: str) -> Distribution:
    try:
        version = metadata.version(name)
    except metadata.PackageNotFoundError as exc:
        raise ImportError(f"package {name!r} not found") from exc
    return Distribution(version)
