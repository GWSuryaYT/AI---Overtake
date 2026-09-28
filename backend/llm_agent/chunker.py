import re


class Chunky:

    def __init__(self):
        print(f"✅[Success] Loaded Chunky")

    def chunk_maker(
        self, paragraph: str, overlap: int = 10, chunk_size: int = 30
    ) -> list[str]:

        # now lets split in full stops to get a list of texts to make them chunks:
        # UPGRADE: Uses regex lookbehind to keep sentence punctuation (.!?) and handles missing spaces after periods cleanly
        sentence_list = [
            s.strip()
            for s in re.split(r"(?<=[.!?])", paragraph.strip())
            if s.strip()
        ]

        # now from these sentence list we will pick 1 sentence and keep adding them until chunk_size fills in:
        all_chunks = []
        # UPGRADE: Track sentences as a list to assemble clean strings without double periods or spacing bugs
        current_chunk_sentences = []
        current_word_count = 0

        for sentence in sentence_list:

            # how many words are there in the text_chunk yet?
            # UPGRADE: Calculate length of the incoming sentence to check if adding it will breach chunk_size
            sentence_words = len(sentence.split())

            # now if words of the chunk alr reached more than the chunk_size then just give it some info about last line over_lap words and its good to go store it in a database.
            # UPGRADE: Triggers chunk creation before adding the sentence if it would exceed chunk_size
            if (
                current_word_count + sentence_words > chunk_size
                and current_chunk_sentences
            ):

                # first append the text to the list:
                text_chunk = " ".join(current_chunk_sentences)
                all_chunks.append(text_chunk)

                # now we will refresh the text_chunk like take the overlap part and then add the sentence of the current loop which will repeat again until sentences end:
                # UPGRADE: Overlap is now sentence-aware so complete sentences are kept instead of cutting off middle words
                overlap_sentences = []
                overlap_words = 0

                # backtrack from recent sentences to fill the overlap budget cleanly
                for prev_sentence in reversed(current_chunk_sentences):
                    prev_words = len(prev_sentence.split())
                    if (
                        overlap_words + prev_words <= overlap
                        or not overlap_sentences
                    ):
                        overlap_sentences.insert(0, prev_sentence)
                        overlap_words += prev_words
                    else:
                        break

                current_chunk_sentences = overlap_sentences
                current_word_count = overlap_words

            # now if words are less than the chunk_size then we will add another sentence:
            current_chunk_sentences.append(sentence)
            current_word_count += sentence_words

        # after all sentences ended the if/else command cant run so we need to append the text_chunk ourselvs dosent matter size this time:
        if current_chunk_sentences:
            all_chunks.append(" ".join(current_chunk_sentences))

        return all_chunks

