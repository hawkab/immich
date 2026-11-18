"""Exercise release source binding against a real, isolated Git repository.

Author: Olshansky Grigory.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

from build_aegis_android import pin_source, verify_source


class SourceBindingTests(unittest.TestCase):
    """Prevent changing or dirty inputs from being labelled as a clean release."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name)
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Synthetic build test')
        self.git('config', 'user.email', 'test@example.invalid')
        (self.source / 'source.txt').write_text('original\n')
        self.commit()

    def git(self, *args):
        """Keep fixture commits local and free of real identities or credentials."""
        subprocess.run(['git', *args], cwd=self.source, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def commit(self):
        """Create a synthetic repository version used only by the test."""
        self.git('add', 'source.txt')
        self.git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')

    def test_changed_tracked_source_cannot_start_a_release(self):
        (self.source / 'source.txt').write_text('modified\n')
        with self.assertRaisesRegex(RuntimeError, 'Tracked source changed'):
            pin_source(self.source)

    def test_commit_change_during_build_cannot_relabel_the_artifact(self):
        commit = pin_source(self.source)
        (self.source / 'source.txt').write_text('next version\n')
        self.commit()
        with self.assertRaisesRegex(RuntimeError, 'Source commit changed'):
            verify_source(self.source, commit)

    def test_unchanged_source_allows_untracked_build_cache(self):
        commit = pin_source(self.source)
        (self.source / 'build-cache').write_bytes(b'generated')
        verify_source(self.source, commit)


if __name__ == '__main__':
    unittest.main()
