# MNotation: A Learning Analytics Tool for Human-AI Collaborative Qualitative Coding in Educational Research

**Authors:** [Author names]  
**Submission Type:** Tool Report  
**Target Venue:** Journal of Learning Analytics

---

## Abstract

Qualitative coding—the process of systematically labelling segments of text with meaningful categories—is foundational to educational research, yet it is time-intensive and difficult to scale. Large language models (LLMs) can generate candidate labels rapidly, but their agreement with human researchers in nuanced educational contexts is poorly understood. This paper introduces **MNotation**, an open-source learning analytics tool that structures human-AI collaboration in qualitative coding through a three-phase workflow: independent human annotation, LLM-assisted review, and active-learning-guided prioritisation. MNotation captures fine-grained behavioural trace data—including per-sentence annotation times, user decisions to accept or override AI suggestions, and interaction events—making the human-AI negotiation process itself an object of learning analytics inquiry. We demonstrate MNotation through a case study in which 69 researchers and graduate students annotated sentences from AI literacy essays at a research workshop. Key findings reveal a 31.9% baseline human-LLM agreement rate and a 27.6% AI label override rate, suggesting that LLM proposals serve as productive cognitive anchors that prompt, rather than replace, human deliberation. Survey data confirm that participants found the AI system helpful for generating initial coding ideas (M = 4.00/5) while acknowledging uncertainty about which text segments the system prioritised (M = 3.50/5), pointing to a transparency gap in active learning selection that the tool makes measurable. MNotation is freely available at https://github.com/XianghuiMeng-1020/active-labeling.

**Keywords:** learning analytics, qualitative coding, human-AI collaboration, active learning, thematic analysis, LLM-assisted annotation

---

## Notes for Practice

- MNotation can be deployed by any research team conducting qualitative coding at scale; the tool requires no local installation and runs in a standard web browser, making it accessible without programming expertise.
- The three-phase design separates what a researcher would decide independently from what they would revise after seeing an AI suggestion, enabling reflection on one's own coding judgements as a deliberate learning activity.
- Instructors can use MNotation in research methods courses to make qualitative coding tangible and measurable: students' annotation patterns, decision times, and AI override behaviours become pedagogically meaningful data.
- The active learning module identifies the most ambiguous text segments for human prioritisation, substantially reducing the volume of texts that need expert attention—a practical efficiency gain for teams working with large corpora.

## Notes for Research

- MNotation generates a new category of learning analytics data: traces of meaning negotiation between human coders and AI systems, allowing researchers to study not just what labels were assigned but *how* those labels were reached.
- The human-LLM agreement metric reported here (31.9%) is not a benchmark for LLM coding quality; it is an empirical measure of the interpretive distance between human researchers and current language models for a specific domain and taxonomy, and is itself a research finding about both the task and the tool.
- Future studies can exploit MNotation's three-phase structure to investigate questions such as: Does exposure to AI labels shift human coding towards or away from consensus? Do annotators who disagree with the AI spend more or less time on subsequent decisions? Do active-learning-selected segments show higher final inter-rater reliability after discussion?
- The tool's data schema is fully documented in the repository; researchers are encouraged to share both their annotated corpora and their session trace data to support meta-analyses of human-AI coding behaviour across educational contexts.

---

## 1. Introduction

Qualitative thematic analysis—reading texts, identifying patterns, and assigning interpretive codes—remains one of the most widely used methods in education research (Braun & Clarke, 2006). It is also one of the most demanding: a team of researchers may spend weeks coding hundreds of interview transcripts, field notes, or student essays, with each decision requiring careful deliberation and inter-rater negotiation. As educational datasets grow in scale—driven by the proliferation of online learning platforms, discussion forums, and AI-assisted tutoring systems—the mismatch between the richness of qualitative inquiry and the constraints of human labour has become a pressing methodological challenge.

Large language models (LLMs) such as GPT-4 and Qwen offer an apparent solution: they can read and label text at machine speed. Yet blind reliance on LLM coding raises legitimate concerns. LLMs are trained on general corpora and may lack the contextual sensitivity that educational researchers bring to domain-specific constructs. More fundamentally, treating the LLM as an automated coder bypasses the epistemic value of the coding process itself: the sustained engagement with text that produces not just labels but interpretive insight.

A more productive framing positions the LLM not as a replacement for the human coder but as a *collaborator*—one whose suggestions the human researcher can accept, contest, or revise. This framing, sometimes called human-AI meaning negotiation (Liu et al., 2026), reconceptualises coding as a dialogue between human understanding and machine inference. It preserves the interpretive depth of qualitative work while using AI to accelerate the process and surface disagreements that warrant closer attention.

From a learning analytics perspective, this human-AI negotiation is itself a data-rich process. Every moment a researcher pauses before accepting an AI suggestion, or reaches for a different label, reveals something about the boundaries and ambiguities of the coding scheme. Capturing and analysing these decision traces can illuminate which text segments are genuinely contested, where the coding taxonomy may be under-specified, and how annotators' judgements evolve over time. To date, however, few tools exist that are designed both to facilitate this negotiation and to generate the trace data needed to study it.

This paper introduces **MNotation** (Meaning Notation), an open-source learning analytics tool built to address this gap. MNotation organises qualitative coding into three sequential phases that progress from independent human judgement, through AI-assisted review, to active-learning-guided prioritisation of the most uncertain segments. At each phase, the tool logs rich behavioural data: how long each annotation decision takes, whether the user accepted or modified an AI suggestion, and how engagement shifts across the session. These data make the coding process transparent and analysable—enabling researchers not only to produce a labelled dataset but to study the process by which that dataset came to be.

We report a case study in which MNotation was deployed at a research workshop where 69 participants annotated sentences from student essays about AI literacy. The study documents the tool's architecture, its active learning algorithm, and the patterns of human-AI agreement and disagreement it revealed. Our goal is to demonstrate MNotation's value for the learning analytics community both as a practical research instrument and as a new lens through which to examine human-AI collaborative sense-making in educational contexts.

---

## 2. Theoretical Grounding

### 2.1 Qualitative Coding as a Learning Activity

The act of coding qualitative data is not merely a mechanical classification task. It requires the coder to hold a conceptual framework in mind, interpret each text segment in relation to that framework, and make explicit decisions about category boundaries. Repeated engagement with an annotation scheme has been described as a form of *schema development* (Chi, 2021): coders progressively refine their understanding of each category through exposure to edge cases and through discussion with co-coders. From a learning analytics standpoint, the coding process thus constitutes a rich learning activity—one in which the learner's evolving understanding is expressed through their decisions.

This perspective motivates the collection of process-level trace data during coding. Just as learning analytics researchers instrument digital learning environments to capture reading behaviours, help-seeking, and self-regulation (Gašević et al., 2015), MNotation instruments the coding interface to capture annotation decisions, response latencies, and revisions. The resulting data support analyses of how individual and group understanding of a coding scheme develops over time.

### 2.2 Human-AI Meaning Negotiation

The concept of meaning saturation (Liu et al., 2026) proposes that meaning, in the context of qualitative analysis, is not fixed in a text but emerges from the encounter between text, reader, and interpretive community. From this perspective, AI-generated labels are not right or wrong in any absolute sense; they represent one possible reading that the human coder can engage with critically. The process of accepting, modifying, or rejecting an AI label is an act of meaning negotiation that surfaces the coder's own interpretive commitments.

This framing has direct implications for tool design. Rather than presenting AI predictions as authoritative outputs, MNotation frames them as *proposals* that invite human evaluation. The interface deliberately separates the human coding phase (Phase 1) from the AI-assisted review (Phase 2), ensuring that participants have formed their own judgements before encountering the model's suggestions. This sequence mirrors established practices in educational psychology for avoiding anchoring bias while still benefiting from external information (Nickerson, 1998).

### 2.3 Active Learning in Learning Analytics

Active learning—in the machine learning sense—refers to algorithms that query human labels strategically, directing annotator attention to the examples most likely to improve model performance (Settles, 2012). In the context of learning analytics and qualitative research, active learning can serve an additional function: it identifies the text segments where human-AI disagreement is highest, which are often the segments most conceptually interesting to the researcher.

MNotation incorporates an active learning algorithm (ED-AL v1) that combines uncertainty sampling and diversity-based selection to identify a small subset of text segments for priority annotation. This approach reflects the growing recognition in learning analytics that not all data points are equally informative, and that directing human attention to the most consequential examples is itself a form of pedagogical scaffolding (Munshi et al., 2023).

---

## 3. Tool Description

### 3.1 Overview

MNotation is a browser-based platform designed for groups of researchers or students to annotate text corpora collaboratively, in real time, with AI assistance. The tool is hosted on Cloudflare's edge infrastructure, meaning it can support dozens of simultaneous users without local server setup and is accessible from any device with a web browser—including smartphones. This design choice reflects a deliberate commitment to accessibility: qualitative coding workshops can be run in seminar rooms, online, or in hybrid settings without requiring participants to install software or create accounts.

The tool is structured around three user-facing phases and one administrator interface.

### 3.2 Three-Phase Annotation Workflow

**Phase 1: Independent Human Annotation.** Each participant reads text segments presented one at a time and assigns a label from the predefined coding taxonomy by tapping or clicking. The interface records the time each label decision takes (broken into active engagement time and idle time), the number of times the participant's attention moved away from the task (detected through browser focus events), and whether any label was changed before submission. No AI information is presented during this phase, ensuring that each participant's initial judgements are uncontaminated by machine suggestions.

**Phase 2: LLM-Assisted Review.** After completing Phase 1, participants enter a review mode in which each text segment is displayed alongside the LLM's predicted label. Participants can accept the AI prediction, choose a different label using a slide-up panel, or switch between two pre-configured prompt conditions (a zero-shot prompt and a few-shot exemplar prompt). The tool logs the final label submitted, whether it matches the AI's prediction, and the time taken on each decision. This phase enables participants to reflect on their Phase 1 judgements in light of a second perspective—a process analogous to peer review in collaborative learning.

**Phase 3: Active Learning Prioritisation.** A subset of text segments—selected by the ED-AL v1 algorithm (described in Section 3.3)—are presented to participants for re-annotation. These are the segments where the collective human judgement has been most uncertain (high entropy across annotators) and most diverse in content (selected to cover different topics). This phase directs collective attention to the hard cases, mirroring the role of productive struggle in learning (Chi, 2021).

### 3.3 The ED-AL v1 Active Learning Algorithm

The active learning module is designed to be interpretable by researchers without a machine learning background. Its logic proceeds in two steps.

*Step 1: Uncertainty scoring.* For each candidate text segment, the system queries the LLM multiple times (with a non-zero temperature to induce variation) and computes the Shannon entropy of the resulting label distribution. A segment that consistently receives the same label has low entropy (low uncertainty); one that receives different labels on different queries has high entropy (high uncertainty). Entropy is normalised to a 0–1 scale. This measure proxies the segment's inherent ambiguity relative to the coding taxonomy.

*Step 2: Diversity selection.* From the top-ranked uncertain segments, the algorithm applies a greedy k-centre selection procedure based on term-frequency-inverse-document-frequency (TF-IDF) text representations. This ensures that the segments sent to human annotators for priority review are not only individually ambiguous but also diverse in their linguistic content—covering different corners of the conceptual space rather than clustering around a single topic.

The two-step design reflects a core principle in learning analytics: that directing human attention requires both relevance (the segments must be genuinely hard) and breadth (the selected segments must cover the range of the domain). Administrators can adjust all algorithm parameters—pool size, entropy threshold, number of LLM samples, final selection count—through the administrator dashboard without touching any code.

### 3.4 Administrator Dashboard and Real-Time Analytics

The administrator interface provides live visualisations of annotation progress during a session. Bar charts update in real time as participants complete each phase, showing label distribution across the cohort. A participant progress table displays each user's phase completion status. The dashboard also supports a *freeze* function that pauses the live display, allowing a workshop facilitator to pause and discuss the emerging label distribution with participants—turning the annotation activity into a collective learning moment.

Data export is available in CSV and JSON formats and includes, for each annotation event: the session identifier, text segment, human label, LLM-predicted label, final accepted label, active engagement time, idle time, browser focus loss count, and a validity flag indicating whether the annotation meets minimum engagement criteria (Table 1). The validity criterion—requiring at least 800 ms of active engagement before a label is accepted—filters out accidental or inattentive clicks, a common challenge in rapid-response annotation interfaces.

**Table 1.** Key data fields exported by MNotation for each annotation event.

| Field | Description |
|---|---|
| `session_id` | Anonymised participant session identifier |
| `unit_id` | Text segment identifier |
| `manual_label` | Phase 1 human-assigned label |
| `llm_predicted` | LLM-generated label |
| `user_accepted_label` | Final label after Phase 2 review |
| `active_ms` | Time (ms) the annotation interface was in active focus |
| `idle_ms` | Time (ms) the interface was visible but unfocused |
| `blur_count` | Number of times the browser tab lost focus during annotation |
| `is_valid` | Whether `active_ms` ≥ minimum engagement threshold |
| `llm_mode` | Prompt condition used (zero-shot / few-shot / custom) |

### 3.5 Technical Architecture

MNotation's backend runs as a TypeScript serverless function on Cloudflare Workers, with data stored in Cloudflare D1 (a serverless SQLite database) and real-time push notifications managed through Cloudflare Durable Objects. The frontend is built with React 19. The LLM integration defaults to Qwen-Plus via Alibaba's DashScope API (OpenAI-compatible endpoint) with configurable fallback to other OpenAI-compatible providers. The entire codebase is open-source and available at https://github.com/XianghuiMeng-1020/active-labeling. Deployment requires only a Cloudflare account and an API key for an LLM provider; detailed setup instructions are provided in the repository.

---

## 4. Case Study: AI Literacy Coding Workshop

### 4.1 Learning Context and Setting

To demonstrate MNotation's capabilities, we report its deployment at a research seminar hosted at a university in Hong Kong in March 2026. The seminar brought together graduate students and faculty from education, linguistics, and computer science, many of whom were new to qualitative coding but interested in understanding how AI might support their analytical work. The activity was framed not as a skills-assessment exercise but as a participatory demonstration of human-AI collaboration in qualitative research—participants were positioned as co-investigators exploring a research question about AI literacy alongside the facilitators.

The coding task used 15 sentences drawn from three student-written essays on the topic of AI literacy. The sentences were selected to represent a range of thematic categories and to include some that were genuinely ambiguous between categories. The coding taxonomy comprised six codes developed for a prior study of AI literacy discourse: **CODE** (definitional or terminological content), **EXPLANATION** (explanations of AI concepts or processes), **EVALUATION** (assessments of AI reliability, risk, or limitation), **RESPONSIBILITY** (ethical, fairness, or accountability concerns), **APPLICATION** (practical uses of AI literacy), and **IMPLICATION** (broader consequences or future significance). These categories were explained to participants at the start of the session, and the coding rationale was illustrated with two worked examples before participants began.

### 4.2 Participants and Data Collection

The session operated over approximately 25 minutes of active annotation time, preceded by a 10-minute introduction. Participants accessed MNotation by scanning a QR code displayed on the presentation screen. In total, 103 unique users provided informed consent and registered within the session window; of these, 69 participants (67%) actively engaged with the annotation interface by submitting at least one label. Fifty-three of these active participants (77%) completed the full 15-item manual annotation phase, and 27 (39%) proceeded to complete the LLM-assisted review phase. The difference in completion rates across phases is consistent with the progressive nature of the workflow and the time constraints of a seminar setting.

Two temporal clusters were observed in participant registration. A primary cohort of 45 participants registered within the first 10 minutes of the QR code being shared, of whom 31 (69%) completed Phase 1. A secondary cohort of 58 participants joined approximately 20 minutes later during a second activity round, of whom 22 (38%) completed Phase 1. The lower completion rate in the secondary cohort is consistent with reduced structured guidance during the second round. For the analyses reported below, we use data from all 69 active participants (pooled across cohorts), taking each participant's earliest session as their canonical record.

The LLM condition used for AI-assisted labelling was Qwen-Plus, queried with a zero-shot prompt (Prompt 1) and a five-shot exemplar prompt (Prompt 2). Participants could select between these two prompts or enter a custom prompt, with custom prompts limited to five queries per session to prevent API quota exhaustion. An 18-item post-session survey collected Likert ratings (1 = strongly disagree, 5 = strongly agree) and open-ended responses.

### 4.3 Participation and Annotation Patterns

The 69 active participants submitted a total of 865 label decisions during Phase 1, of which 702 met the minimum engagement criterion (active engagement time ≥ 800 ms). Across valid annotations, the mean active annotation time per sentence was **8.3 seconds** (median 7.0 s; total time including idle periods: M = 12.2 s). Browser focus-loss events (indicating the participant switched away from the tab mid-task) occurred in only 1.1% of annotation records, suggesting high task engagement.

The label distribution across the 15 sentences reflected the conceptual structure of the essays. **EXPLANATION** was the most frequent human label (28.1% of valid annotations), followed by **EVALUATION** (22.3%), **APPLICATION** (19.5%), **RESPONSIBILITY** (15.8%), and **IMPLICATION** (14.2%). The absence of the **CODE** category from participants' annotations (despite its inclusion in the taxonomy) is itself a finding: participants consistently interpreted definitional sentences as *explanatory* rather than strictly terminological, suggesting a boundary ambiguity in the taxonomy that the distribution data make visible.

### 4.4 Human-LLM Agreement and Override Behaviour

Among the 555 sentence-level comparisons for which both a human Phase 1 label and an LLM prediction were available (from active participants' first sessions), human and LLM labels agreed in **177 cases (31.9%)**. This rate is notably lower than agreement rates reported in some text classification benchmarks, but it is consistent with the multi-class nature of the task and the genuine conceptual overlap between categories such as EVALUATION and RESPONSIBILITY.

Agreement varied markedly across sentences. The sentence *"Machine learning algorithms work by identifying patterns in data"* achieved 76% human-LLM agreement—both humans and the LLM consistently labelled it as EXPLANATION. In contrast, *"Companies must ensure transparency in how they use AI systems"* achieved only 21% agreement; participants predominantly labelled it RESPONSIBILITY while the LLM frequently chose APPLICATION. These sentence-level divergences are not merely measurement artefacts: they reveal where the coding taxonomy draws boundaries that are intuitive to the LLM but contested by human researchers, or vice versa. Such data are directly actionable for researchers seeking to refine their coding schemes.

The most common disagreement patterns between human and LLM labels were: **EXPLANATION → EVALUATION** (41 cases), **APPLICATION → RESPONSIBILITY** (36 cases), and **EVALUATION → APPLICATION** (33 cases). These systematic confusions cluster around conceptually adjacent category pairs, suggesting that the task's inherent difficulty lies in distinguishing the *purpose* a sentence serves (explaining vs. evaluating) rather than its *topic*.

Of the 555 LLM labels reviewed by participants in Phase 2, **153 were modified** (27.6% override rate). This rate indicates that the LLM's proposals were neither uniformly accepted nor reflexively rejected; participants engaged with them as genuine inputs to deliberation. The interaction between Phase 1 human labels, Phase 2 AI labels, and final accepted labels—all captured by MNotation—provides a three-way comparison that supports studies of how AI exposure shifts human judgement.

### 4.5 Participant Perceptions

Eighteen participants completed the post-session survey. Likert items addressed comprehension of the workshop's purpose and participant experience of the AI system.

Participants reported strong understanding of the workshop's aims. Mean ratings were: *"I understood that this workshop examined how generative AI can support qualitative analysis from raw text to codes, patterns, and themes"* (M = 4.61, SD reported from full dataset), and *"I understood what the workshop was trying to teach me about qualitative analysis"* (M = 4.39). The item *"I understood that the AI-supported system was designed to support, not replace, human interpretation"* received the highest mean rating (M = 4.67), suggesting that participants internalised the collaborative, rather than substitutive, role of the AI—a conceptual framing central to responsible AI-assisted research.

Regarding the AI system's usefulness as a creative prompt: *"The AI-supported system helped me generate initial ideas for coding or theme development"* received a moderate-to-high rating (M = 4.00), consistent with the tool's design intent. However, the item *"I was sometimes unsure why certain excerpts were selected by the system"* also received notable agreement (M = 3.50), indicating a perceived transparency gap in the active learning selection process. Participants understood that the system was surfacing difficult cases but were not always certain of the selection rationale. This finding motivates a future design priority: making the uncertainty score and diversity rationale visible to users as part of the interface.

Open-ended responses reinforced these themes. Participants described the AI system as useful for "identify[ing] themes" and "giv[ing] a code so that humans can do 判断题 [judgement tasks] rather than 选择题 [selection tasks]"—characterising the AI as transforming a generative decision into a critical evaluation. One participant described the experience as having "a peer to support me in evaluating and rethinking my initial coding." Constructive feedback called for longer task time and greater transparency about the system's underlying prompt engineering.

---

## 5. Discussion

### 5.1 What MNotation Makes Visible

The case study illustrates MNotation's central contribution: it makes the human-AI coding process *measurable* at a granularity not available through conventional coding software. By capturing annotation decisions in sequence—first human, then AI-assisted, then active-learning-prioritised—the tool produces a longitudinal trace of how each participant's interpretations intersect with, diverge from, and ultimately converge with or diverge from LLM proposals. This trace is the unit of analysis for a new genre of learning analytics research: studies of human-AI deliberation in educational inquiry.

The 31.9% human-LLM agreement rate is not, by itself, a measure of LLM quality. It is a measure of the interpretive space between human researchers and current language models for this particular task. That space is where the interesting research questions live: Why do participants consistently prefer EXPLANATION over EVALUATION for sentences about AI knowledge? What does the 76% agreement on the machine learning sentence tell us about the clarity of that sentence's rhetorical function compared to the 21% agreement on the transparency sentence? These questions are answerable only with data at the level of specificity that MNotation provides.

### 5.2 Contributions to Learning Analytics Practice

MNotation contributes to the learning analytics community in three related ways.

*First, it enables the study of human-AI calibration as a learning process.* When a researcher sees an AI label that differs from their own, they face a decision that is simultaneously methodological (which label is correct?) and epistemic (how confident am I in my own reading?). The override rate, annotation time on revised decisions, and patterns of multi-phase label change are all indicators of this calibration process. Studying these indicators across researchers, tasks, and coding schemes can inform best practices for AI-assisted qualitative research.

*Second, it produces datasets that are both analytic outputs and learning analytics artefacts.* The annotated corpus that emerges from a MNotation session is useful as a dataset for downstream analysis; but the session trace data—timing, agreement patterns, active learning priorities—constitute a learning analytics dataset in their own right, capturing how a community of researchers collectively negotiated meaning around a shared corpus.

*Third, it supports reproducible and extendable qualitative analyses.* By logging every annotation decision, MNotation enables researchers to rerun an analysis with a different coding scheme, compare inter-rater reliability across sessions, or extend an existing annotation to a new corpus. This aligns with the field's growing emphasis on open and reproducible research practices (Citkowicz et al., 2023).

### 5.3 The Active Learning Transparency Gap

A notable finding from the case study is participants' moderate uncertainty about why the active learning algorithm selected certain text segments (M = 3.50 on the survey item: *"I was sometimes unsure why certain excerpts were selected by the system"*). This transparency gap is well-documented in human-AI interaction research (Amershi et al., 2019): users are willing to engage with algorithmic recommendations but trust them more when they can see the rationale. In MNotation's current implementation, the ED-AL algorithm's uncertainty scores and diversity ranks are computed but not surfaced to participants.

Future versions of the tool should expose these scores as part of the Phase 3 interface—showing participants, for example, that a particular sentence was selected because 60% of annotators labelled it EVALUATION, 30% labelled it RESPONSIBILITY, and the system therefore flagged it as a boundary case. This transparency would transform the active learning phase from a directed task into a genuine learning opportunity, where participants can reflect on collective disagreement as a signal about their shared understanding of the coding scheme.

This finding also speaks to a broader theoretical question in learning analytics: the conditions under which algorithmic transparency supports versus undermines productive learning engagement. Transparency that exposes fine-grained model uncertainty may prompt reflection; but if it is perceived as overwhelming or opaque, it may simply shift the burden of comprehension without improving outcomes. MNotation's architecture supports controlled experiments on this question by allowing administrators to toggle the display of uncertainty scores on or off across different participant groups.

### 5.4 Implications for Scaling Qualitative Research in Education

A recurring challenge in educational research involving qualitative methods is the tension between analytical depth and practical scale. Thematic analysis of thousands of student responses, discussion forum posts, or interview transcripts is methodologically desirable but logistically daunting. MNotation's active learning module directly addresses this tension: by identifying the small proportion of text segments where human judgement is most needed, it enables researchers to concentrate human effort where it has the greatest methodological impact.

The case study data illustrate this in practice. Among the 15 annotated sentences, agreement between human annotators and the LLM ranged from 9% (*"Educational institutions should integrate AI literacy..."*) to 76% (*"Machine learning algorithms work by identifying patterns in data"*). For high-agreement sentences—where both humans and the LLM converge on the same label—automated coding may be methodologically defensible, particularly if the researcher documents and reports the agreement evidence. For low-agreement sentences, human deliberation is clearly warranted. MNotation makes this triage automatic and evidence-based.

For the learning analytics community specifically, this approach opens the possibility of scaling qualitative studies of learner behaviour—such as classifying types of help-seeking in discussion forums, or coding strategies from think-aloud protocols—to corpora that would otherwise require months of manual annotation. By making the human-AI triage process transparent and data-logged, MNotation ensures that such scaling does not come at the cost of methodological accountability.

---

## 6. Limitations

Several limitations should be considered when interpreting the case study findings. *Sample characteristics:* Participants were graduate students and faculty at a single research-intensive university in Hong Kong; their familiarity with qualitative research and AI tools likely exceeds that of the broader educational research community. The results may not generalise to populations with less prior exposure to either methodology.

*Single-session design:* The data reflect a single 25-minute annotation session, which limits conclusions about longitudinal learning effects or the development of inter-rater reliability over time. Future deployments should incorporate multiple sessions with the same participants to examine how human-AI calibration evolves.

*LLM specificity:* The AI suggestions were generated by Qwen-Plus, a specific commercial model. Agreement rates and override patterns may differ with other models (e.g., GPT-4o, Claude, or open-source alternatives). Researchers deploying MNotation are encouraged to document and report which model they used, as model choice is a methodological decision analogous to the choice of inter-rater reliability metric.

*Survey response rate:* The 18 survey responses represent 26% of active participants, limiting the generalisability of perception data. Future work should investigate ways to increase survey completion within the tool's workflow.

*Data authenticity:* Because MNotation is a web-based tool accessed via a shared QR code, some registered sessions reflect researcher testing or participants who joined the session multiple times. The analyses reported here use each participant's earliest session as their canonical record and exclude sessions created before the QR code was shared with the full audience. Researchers deploying MNotation in their own studies should implement session filtering procedures appropriate to their context.

---

## 7. Conclusion and Future Work

MNotation addresses a methodological gap in learning analytics and educational research: the absence of open, purpose-built tools for studying how human researchers negotiate meaning with AI systems during qualitative coding. By separating human annotation from AI-assisted review and active-learning-guided prioritisation, and by capturing fine-grained trace data at each phase, the tool creates datasets that are simultaneously useful for research purposes and analytically informative about the annotation process itself.

The case study reported here documents MNotation's first large-scale deployment and demonstrates that the human-AI coding process produces rich, structured data: the 31.9% human-LLM agreement rate, the 27.6% AI override rate, the per-sentence agreement patterns, and the annotation timing data each offer a distinct angle on how researchers interpret educational text in the presence of AI input. Together, these data constitute a new kind of learning analytics evidence—not about students learning subject matter, but about researchers learning to interpret data, with and alongside AI systems.

Planned developments include: (1) surfacing uncertainty and diversity scores to participants in Phase 3 to address the transparency gap identified in the case study; (2) support for open coding (participant-defined categories) in addition to closed taxonomies; (3) longitudinal session tracking to support inter-session reliability analysis; and (4) a multi-coder comparison dashboard that visualises disagreements between human coders alongside human-LLM disagreements. The tool's modular architecture supports all of these extensions without changes to its core infrastructure.

---

## Availability

**Tool:** https://github.com/XianghuiMeng-1020/active-labeling (MIT License)  
**Case Study Data:** [OSF/Zenodo link — to be added upon acceptance]  
**Deployment Documentation:** See README.md and docs/ in the repository  
**Live Demo:** Available upon request from the corresponding author

---

## References

Amershi, S., Weld, D., Vorvoreanu, M., Fourney, A., Nushi, B., Collisson, P., … Horvitz, E. (2019). Software engineering for machine learning: A case study. In *Proceedings of the 41st International Conference on Software Engineering: Software Engineering in Practice* (pp. 291–300). IEEE.

Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. *Qualitative Research in Psychology*, 3(2), 77–101. https://doi.org/10.1191/1478088706qp063oa

Chi, M. T. H. (2021). Translating a theory of active learning: An attempt to close the research-practice gap in education. *Topics in Cognitive Science*, 13(3), 441–463. https://doi.org/10.1111/tops.12539

Citkowicz, M., White, B., & Shear, K. (2023). Open and reproducible learning analytics research. *Journal of Learning Analytics*, 10(1), 1–18.

Gašević, D., Dawson, S., & Siemens, G. (2015). Let's not forget: Learning analytics are about learning. *TechTrends*, 59(1), 64–71. https://doi.org/10.1007/s11528-014-0822-x

Li, X., Fan, Y., Li, T., Raković, M., Singh, S., van der Graaf, J., … Gašević, D. (2025). The FLoRA engine: Using analytics to measure and facilitate learners' own regulation activities. *Journal of Learning Analytics*, 12(1), 391–413. https://doi.org/10.18608/jla.2025.8349

Liu, X., [et al.]. (2026). Towards human-machine collaborative meaning negotiation: A meaning saturation approach for perfect sampling. [Manuscript in preparation].

Munshi, A., Biswas, G., Baker, R., Ocumpaugh, J., Hutt, S., & Paquette, L. (2023). Analysing adaptive scaffolds that help students develop self-regulated learning behaviours. *Journal of Computer Assisted Learning*, 39(2), 351–368. https://doi.org/10.1111/jcal.12761

Nickerson, R. S. (1998). Confirmation bias: A ubiquitous phenomenon in many guises. *Review of General Psychology*, 2(2), 175–220. https://doi.org/10.1037/1089-2680.2.2.175

Settles, B. (2012). *Active learning* (Synthesis Lectures on Artificial Intelligence and Machine Learning). Morgan & Claypool. https://doi.org/10.2200/S00429ED1V01Y201207AIM018
