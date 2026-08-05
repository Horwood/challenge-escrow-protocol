// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrow } from "../src/ChallengeEscrow.sol";
import { ChallengeEscrowKernel } from "../src/ChallengeEscrowKernel.sol";
import { ChallengeTypes } from "../src/ChallengeTypes.sol";
import { AcceptancePermitHash } from "../src/libraries/AcceptancePermitHash.sol";
import { ChallengeCommitment } from "../src/libraries/ChallengeCommitment.sol";
import { AdversarialToken } from "./mocks/AdversarialToken.sol";

interface VmChallenge {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectPartialRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract CommitmentHarness {
    function executionPreimage(ChallengeTypes.ChallengeExecution memory execution)
        external
        pure
        returns (bytes memory)
    {
        return ChallengeCommitment.executionPreimage(execution);
    }

    function executionHash(ChallengeTypes.ChallengeExecution memory execution)
        external
        pure
        returns (bytes32)
    {
        return ChallengeCommitment.executionHash(execution);
    }

    function specHash(bytes32 executionHash_, bytes32 termsHash_) external pure returns (bytes32) {
        return ChallengeCommitment.specHash(executionHash_, termsHash_);
    }

    function permitDigest(
        uint256 chainId,
        address verifyingContract,
        ChallengeTypes.AcceptancePermit memory permit
    ) external pure returns (bytes32) {
        return AcceptancePermitHash.digest(
            AcceptancePermitHash.domainSeparator(
                "Challenge Escrow", "challenge-escrow-protocol/v1", chainId, verifyingContract
            ),
            permit
        );
    }
}

contract SelfAddressFactory {
    function predictedChild() public view returns (address) {
        // A contract's first CREATE uses nonce one. The RLP payload is
        // [20-byte address, one-byte nonce].
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xd6), bytes1(0x94), address(this), bytes1(0x01))
                    )
                )
            )
        );
    }

    function deployCanonicalSelf(address resolver, address arbiter, address pauser)
        external
        returns (address)
    {
        return address(new ChallengeEscrow(predictedChild(), 6, resolver, arbiter, pauser, false));
    }

    function deployPauserSelf(address token, address resolver, address arbiter)
        external
        returns (address)
    {
        return address(new ChallengeEscrow(token, 6, resolver, arbiter, predictedChild(), false));
    }
}

contract ChallengeEscrowTest {
    struct ReleaseDeclaredEventData {
        string eventProtocolId;
        string protocolVersion;
        string challengeSchemaId;
        string evidenceSchemaId;
        uint256 chainId;
        address escrowContract;
        address canonicalToken;
        uint8 tokenDecimals;
        uint8 valueMode;
        address resolver;
        address arbiter;
        bool initialPaused;
    }

    struct ChallengeCreatedEventData {
        bytes32 specHash;
        bytes32 instanceNonce;
        uint8 challengerSide;
        uint256 stakeAmount;
        uint256 acceptanceNonce;
        uint64 acceptanceDeadline;
        uint64 observationTime;
        uint64 sourceCorrectionCutoff;
        uint64 proposalDeadline;
        uint64 disputeWindowSeconds;
        uint64 arbitrationWindowSeconds;
        uint64 timeoutVoidAt;
        bytes32 executionHash;
        bytes32 termsHash;
        uint64 createdAt;
    }

    VmChallenge private constant vm =
        VmChallenge(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant CHALLENGER_KEY = 0xA11CE;
    uint256 private constant ACCEPTOR_KEY = 0xB0B;
    uint64 private constant NOW = 1_800_000_000;
    uint256 private constant STAKE = 10_000_000;
    bytes32 private constant EVENT_TERMS_HASH =
        0x6ade1e23704b07995277edf96ccf2285990aaee78d20a0f77219965ef9dd7665;
    bytes32 private constant EVENT_MATCH_EVIDENCE_HASH =
        0xecec38a02235c7fb45d2f1efc1d4eba53e02a066d9c1afc3de95decd1d74be6f;
    bytes32 private constant EVENT_ABSENCE_EVIDENCE_HASH =
        0x23617293ae2dd672f0120e63b585dda0ba0f3dd8d55464f8eb59a8fb05d55613;
    bytes32 private constant INCOMPLETE_EVIDENCE_HASH = keccak256("incomplete-event-range");
    bytes32 private constant AMBIGUOUS_EVIDENCE_HASH = keccak256("ambiguous-canonicality");
    bytes32 private constant RELEASE_DECLARED_SIGNATURE = keccak256(
        "ReleaseDeclared(bytes32,string,string,string,string,uint256,address,address,uint8,uint8,address,address,bool)"
    );
    bytes32 private constant CHALLENGE_CREATED_SIGNATURE = keccak256(
        "ChallengeCreated(bytes32,bytes32,bytes32,address,uint8,uint256,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint64,bytes32,bytes32,uint64)"
    );

    address private constant RESOLVER = address(0xBEEF);
    address private constant ARBITER = address(0xCA11);
    address private constant PAUSER = address(0xF00D);

    AdversarialToken private token;
    ChallengeEscrow private release;
    address private challenger;
    address private acceptor;

    function setUp() public {
        vm.warp(NOW);
        challenger = vm.addr(CHALLENGER_KEY);
        acceptor = vm.addr(ACCEPTOR_KEY);
        token = new AdversarialToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        token.mint(challenger, STAKE * 10);
        token.mint(acceptor, STAKE * 10);
        vm.prank(challenger);
        token.approve(address(release), type(uint256).max);
        vm.prank(acceptor);
        token.approve(address(release), type(uint256).max);
    }

    function testProtocolTupleAndCommitmentDomains() public view {
        require(
            keccak256(bytes(release.EVENT_PROTOCOL_ID())) == keccak256("challenge-escrow-event/v1")
        );
        require(
            keccak256(bytes(release.PROTOCOL_VERSION()))
                == keccak256("challenge-escrow-protocol/v1")
        );
        require(
            keccak256(bytes(release.CHALLENGE_SCHEMA_ID())) == keccak256("challenge-escrow.spec/v1")
        );
        require(
            keccak256(bytes(release.EVIDENCE_SCHEMA_ID()))
                == keccak256("challenge-escrow.evidence/v1")
        );
        require(
            keccak256(bytes(release.CONDITION_LANGUAGE_ID()))
                == keccak256("challenge-escrow.condition-language/v1")
        );
        require(keccak256(bytes(release.TERMS_DOMAIN())) == keccak256("challenge-escrow.terms/v1"));
        require(keccak256(bytes(release.SPEC_DOMAIN())) == keccak256("challenge-escrow.spec/v1"));
        require(
            keccak256(bytes(release.EVIDENCE_DOMAIN())) == keccak256("challenge-escrow.evidence/v1")
        );
    }

    function testReleaseDeclaresProtocolTupleOnce() public {
        vm.recordLogs();
        ChallengeEscrow declared =
            new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        VmChallenge.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1 && logs[0].emitter == address(declared));
        require(logs[0].topics.length == 2 && logs[0].topics[0] == RELEASE_DECLARED_SIGNATURE);
        require(logs[0].topics[1] == declared.releaseId());
        ReleaseDeclaredEventData memory eventData = _decodeReleaseDeclared(logs[0].data);
        require(
            keccak256(bytes(eventData.eventProtocolId))
                == keccak256(bytes(declared.EVENT_PROTOCOL_ID())),
            "event protocol id"
        );
        require(
            keccak256(bytes(eventData.protocolVersion))
                == keccak256(bytes(declared.PROTOCOL_VERSION())),
            "protocol version"
        );
        require(
            keccak256(bytes(eventData.challengeSchemaId))
                == keccak256(bytes(declared.CHALLENGE_SCHEMA_ID())),
            "challenge schema"
        );
        require(
            keccak256(bytes(eventData.evidenceSchemaId))
                == keccak256(bytes(declared.EVIDENCE_SCHEMA_ID())),
            "evidence schema"
        );
        require(eventData.chainId == block.chainid, "chain id");
        require(eventData.escrowContract == address(declared), "escrow address");
        require(eventData.canonicalToken == address(token), "token address");
        require(eventData.tokenDecimals == declared.tokenDecimals(), "token decimals");
        require(
            eventData.valueMode == uint8(ChallengeTypes.ValueMode.TESTNET_NO_VALUE), "value mode"
        );
        require(eventData.resolver == declared.resolver(), "resolver");
        require(eventData.arbiter == declared.arbiter(), "arbiter");
        require(eventData.initialPaused == declared.paused(), "paused");
    }

    function testChallengeCreatedEventReconcilesStorageAndCreatesNoEntitlement() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(291)), ChallengeTypes.Side.B);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.recordLogs();
        vm.prank(challenger);
        bytes32 challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        VmChallenge.Log[] memory logs = vm.getRecordedLogs();
        VmChallenge.Log memory created;
        uint256 matches;
        for (uint256 index = 0; index < logs.length; index++) {
            if (
                logs[index].emitter == address(release)
                    && logs[index].topics[0] == CHALLENGE_CREATED_SIGNATURE
            ) {
                created = logs[index];
                matches += 1;
            }
        }
        require(matches == 1);
        require(created.topics.length == 3 && created.topics[1] == challengeId);
        require(address(uint160(uint256(created.topics[2]))) == challenger);

        ChallengeCreatedEventData memory eventData =
            abi.decode(created.data, (ChallengeCreatedEventData));
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(
            eventData.specHash == challenge.specHash
                && eventData.instanceNonce == challenge.instanceNonce
        );
        require(
            eventData.challengerSide == uint8(challenge.challengerSide)
                && eventData.stakeAmount == challenge.stakeAmount
        );
        require(eventData.acceptanceNonce == challenge.acceptanceNonce);
        require(eventData.acceptanceDeadline == challenge.acceptanceDeadline);
        require(eventData.observationTime == challenge.observationTime);
        require(eventData.sourceCorrectionCutoff == challenge.sourceCorrectionCutoff);
        require(eventData.proposalDeadline == challenge.proposalDeadline);
        require(eventData.disputeWindowSeconds == challenge.disputeWindowSeconds);
        require(eventData.arbitrationWindowSeconds == challenge.arbitrationWindowSeconds);
        require(eventData.timeoutVoidAt == challenge.timeoutVoidAt);
        require(
            eventData.executionHash == challenge.executionHash
                && eventData.termsHash == challenge.termsHash
        );
        require(eventData.createdAt == challenge.createdAt);
        require(!release.getEntitlement(challengeId, challenger).exists);
        require(release.totalOutstandingLiability() == execution.stakeAmount);
    }

    function testGoldenCommitments() public {
        CommitmentHarness harness = new CommitmentHarness();
        ChallengeTypes.ChallengeExecution memory execution = ChallengeTypes.ChallengeExecution({
            nonce: 0x4444444444444444444444444444444444444444444444444444444444444444,
            createdAt: 1_783_814_400,
            chainId: 31_337,
            escrowContract: 0x1111111111111111111111111111111111111111,
            challengerWallet: 0x2222222222222222222222222222222222222222,
            challengerSide: ChallengeTypes.Side.A,
            token: 0x3333333333333333333333333333333333333333,
            tokenDecimals: 6,
            stakeAmount: 10_000_000,
            acceptanceDeadline: 1_783_818_000,
            observationTime: 1_783_900_800,
            sourceCorrectionCutoff: 1_783_908_000,
            proposalDeadline: 1_783_911_600,
            disputeWindowSeconds: 43_200,
            arbitrationWindowSeconds: 43_200,
            timeoutVoidAt: 1_783_998_000
        });
        bytes memory preimage = harness.executionPreimage(execution);
        bytes32 executionHash = harness.executionHash(execution);
        require(preimage.length == 576);
        require(executionHash == 0x6d37395adf5235337c3406185ee76d2625cb08f06e66df2f49d6e28a467840db);
        bytes32 termsHash = 0x71fa6106febe78f33bf5516b0937e5b0fc88b1e9fec99d651838c2566fdd7f96;
        require(
            harness.specHash(executionHash, termsHash)
                == 0x79378c69fed2b3643b9538784042f8fe8294615bf10067dc6af244341f17fa1b
        );

        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: 0x4fec9d991acf60bc3d2323b19172b6e153976f439cc55eb5796b3a494350f77d,
            specHash: 0x79378c69fed2b3643b9538784042f8fe8294615bf10067dc6af244341f17fa1b,
            acceptingWallet: 0x7777777777777777777777777777777777777777,
            acceptanceNonce: 0,
            expiresAt: 1_783_814_400
        });
        require(
            harness.permitDigest(31_337, 0x1111111111111111111111111111111111111111, permit)
                == 0xab9ac8d4225e1ea168425dfa0adf5cde3aac56825395d7146df47fb0ba65effc
        );
    }

    function testCanonicalTokenMustBeAContract() public {
        vm.expectPartialRevert(ChallengeEscrowKernel.CanonicalTokenHasNoCode.selector);
        new ChallengeEscrow(address(0x1234), 6, RESOLVER, ARBITER, PAUSER, false);
    }

    function testPauserCannotBeChallenger() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(101)), ChallengeTypes.Side.A);
        execution.challengerWallet = PAUSER;
        token.mint(PAUSER, STAKE);
        vm.prank(PAUSER);
        token.approve(address(release), STAKE);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);

        vm.expectPartialRevert(ChallengeEscrow.ParticipantIsPauser.selector);
        vm.prank(PAUSER);
        release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
    }

    function testPauserCannotAccept() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(102)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        bytes32 challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: PAUSER,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        token.mint(PAUSER, STAKE);
        vm.prank(PAUSER);
        token.approve(address(release), STAKE);

        vm.expectPartialRevert(ChallengeEscrow.ParticipantIsPauser.selector);
        vm.prank(PAUSER);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function testEventMatchSideAReachesIndependentPullPayout() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(1)), ChallengeTypes.Side.A);
        uint256 challengerBefore = token.rawBalanceOf(challenger);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.A,
            uint8(ChallengeTypes.ABReason.PRIMARY_OBSERVATION),
            EVENT_MATCH_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        require(token.rawBalanceOf(challenger) == challengerBefore + STAKE * 2);
        require(release.totalOutstandingLiability() == 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.RESOLVED_A);
    }

    function testCompleteEventAbsenceSideBReachesPullPayout() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(2)), ChallengeTypes.Side.A);
        uint256 acceptorBefore = token.rawBalanceOf(acceptor);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.B,
            uint8(ChallengeTypes.ABReason.PRIMARY_OBSERVATION),
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        vm.prank(acceptor);
        release.claimWinnings(challengeId);
        require(token.rawBalanceOf(acceptor) == acceptorBefore + STAKE * 2);
        require(release.totalOutstandingLiability() == 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.RESOLVED_B);
    }

    function testIncompleteEventEvidenceFailsClosedToVoidAndIndependentRefunds() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(3)), ChallengeTypes.Side.A);
        vm.warp(execution.sourceCorrectionCutoff);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA),
            INCOMPLETE_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        _refundBoth(challengeId);
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(challenge.state == ChallengeTypes.LifecycleState.VOID);
        require(
            challenge.finalResolution.evidenceVoidReason
                == ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA
        );
        require(release.totalOutstandingLiability() == 0);
    }

    function testUnresolvedCanonicalityFailsClosedToVoidAndIndependentRefunds() public {
        (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(4)), ChallengeTypes.Side.B);
        vm.warp(execution.sourceCorrectionCutoff);
        vm.prank(RESOLVER);
        release.propose(
            challengeId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.AMBIGUOUS_SOURCE_RECORD),
            AMBIGUOUS_EVIDENCE_HASH
        );
        vm.warp(release.getChallenge(challengeId).proposal.disputeDeadline);
        release.finalizeUncontested(challengeId);
        _refundBoth(challengeId);
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(challenge.state == ChallengeTypes.LifecycleState.VOID);
        require(
            challenge.finalResolution.evidenceVoidReason
                == ChallengeTypes.EvidenceVoidReason.AMBIGUOUS_SOURCE_RECORD
        );
        require(release.totalOutstandingLiability() == 0);
    }

    function testContractOwnedEvidenceBoundariesRejectZeroHashBadReasonAndWrongParent() public {
        (bytes32 zeroId, ChallengeTypes.ChallengeExecution memory execution) =
            _active(bytes32(uint256(5)), ChallengeTypes.Side.A);
        vm.warp(execution.observationTime);
        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroEvidenceHash.selector);
        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 0, bytes32(0));
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidOutcomeReason.selector);
        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 4, EVENT_MATCH_EVIDENCE_HASH);

        vm.prank(RESOLVER);
        release.propose(zeroId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.expectPartialRevert(ChallengeEscrowKernel.ParentEvidenceHashMismatch.selector);
        vm.prank(challenger);
        release.dispute(
            zeroId, ChallengeTypes.Outcome.B, 0, EVENT_ABSENCE_EVIDENCE_HASH, bytes32(uint256(1))
        );
        require(release.getChallenge(zeroId).state == ChallengeTypes.LifecycleState.PROPOSED);
    }

    function testConstructorRejectsRoleAndTokenBoundaries() public {
        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroCanonicalToken.selector);
        new ChallengeEscrow(address(0), 6, RESOLVER, ARBITER, PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroResolver.selector);
        new ChallengeEscrow(address(token), 6, address(0), ARBITER, PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroArbiter.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, address(0), PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrowKernel.ResolverEqualsArbiter.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, RESOLVER, PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrowKernel.UnsupportedTokenDecimals.selector);
        new ChallengeEscrow(address(token), 19, RESOLVER, ARBITER, PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrow.ZeroPauser.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, address(0), false);

        vm.expectPartialRevert(ChallengeEscrow.ResolverRoleOverlap.selector);
        new ChallengeEscrow(address(token), 6, address(token), ARBITER, PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrow.ArbiterRoleOverlap.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, address(token), PAUSER, false);

        vm.expectPartialRevert(ChallengeEscrow.PauserRoleOverlap.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, RESOLVER, false);

        vm.expectPartialRevert(ChallengeEscrow.PauserRoleOverlap.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, ARBITER, false);

        vm.expectPartialRevert(ChallengeEscrow.PauserRoleOverlap.selector);
        new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, address(token), false);
    }

    function testConstructorRejectsSelfReferentialTokenAndPauser() public {
        SelfAddressFactory canonicalFactory = new SelfAddressFactory();
        vm.expectPartialRevert(ChallengeEscrowKernel.CanonicalTokenEqualsEscrow.selector);
        canonicalFactory.deployCanonicalSelf(RESOLVER, ARBITER, PAUSER);

        SelfAddressFactory pauserFactory = new SelfAddressFactory();
        vm.expectPartialRevert(ChallengeEscrow.PauserRoleOverlap.selector);
        pauserFactory.deployPauserSelf(address(token), RESOLVER, ARBITER);
    }

    function testPauseBlocksCreationAcceptanceAndProposal() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(6)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);

        _setPaused(true);
        vm.expectPartialRevert(ChallengeEscrowKernel.ContractPaused.selector);
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, specHash);

        _setPaused(false);
        vm.prank(challenger);
        bytes32 challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));

        _setPaused(true);
        vm.expectPartialRevert(ChallengeEscrowKernel.ContractPaused.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));

        _setPaused(false);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        vm.warp(execution.observationTime);
        _setPaused(true);
        vm.expectPartialRevert(ChallengeEscrowKernel.ContractPaused.selector);
        vm.prank(RESOLVER);
        release.propose(challengeId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
    }

    function testCreateRejectsEveryExecutionBoundary() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(7)), ChallengeTypes.Side.A);

        execution.nonce = bytes32(0);
        _expectCreateRevert(execution, ChallengeEscrowKernel.ZeroInstanceNonce.selector, challenger);
        execution = _execution(bytes32(uint256(8)), ChallengeTypes.Side.A);
        execution.chainId = block.chainid + 1;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidExecutionChain.selector, challenger
        );
        execution = _execution(bytes32(uint256(9)), ChallengeTypes.Side.A);
        execution.escrowContract = address(0x1234);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidExecutionEscrow.selector, challenger
        );
        execution = _execution(bytes32(uint256(10)), ChallengeTypes.Side.A);
        execution.token = address(0x1234);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidExecutionToken.selector, challenger
        );
        execution = _execution(bytes32(uint256(11)), ChallengeTypes.Side.A);
        execution.tokenDecimals = 7;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidExecutionTokenDecimals.selector, challenger
        );

        execution = _execution(bytes32(uint256(12)), ChallengeTypes.Side.A);
        execution.challengerWallet = address(0);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidChallengerWallet.selector, challenger
        );
        execution = _execution(bytes32(uint256(13)), ChallengeTypes.Side.A);
        execution.challengerWallet = address(release);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidChallengerWallet.selector, challenger
        );
        execution = _execution(bytes32(uint256(14)), ChallengeTypes.Side.A);
        execution.challengerWallet = address(token);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidChallengerWallet.selector, challenger
        );
        execution = _execution(bytes32(uint256(15)), ChallengeTypes.Side.A);
        execution.challengerWallet = RESOLVER;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidChallengerWallet.selector, challenger
        );
        execution = _execution(bytes32(uint256(16)), ChallengeTypes.Side.A);
        execution.challengerWallet = ARBITER;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidChallengerWallet.selector, challenger
        );

        execution = _execution(bytes32(uint256(17)), ChallengeTypes.Side.A);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.CallerNotChallenger.selector, address(0xCAFE)
        );
        execution = _execution(bytes32(uint256(18)), ChallengeTypes.Side.A);
        execution.stakeAmount = 0;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidStakeAmount.selector, challenger
        );
        execution = _execution(bytes32(uint256(19)), ChallengeTypes.Side.A);
        execution.stakeAmount = type(uint256).max / 2 + 1;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidStakeAmount.selector, challenger
        );
        execution = _execution(bytes32(uint256(20)), ChallengeTypes.Side.A);
        execution.createdAt = uint64(block.timestamp + 1);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.CreatedAtAfterOpening.selector, challenger
        );
        execution = _execution(bytes32(uint256(21)), ChallengeTypes.Side.A);
        execution.acceptanceDeadline = uint64(block.timestamp);
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidAcceptanceDeadline.selector, challenger
        );
        execution = _execution(bytes32(uint256(22)), ChallengeTypes.Side.A);
        execution.observationTime = execution.acceptanceDeadline;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidObservationTime.selector, challenger
        );
        execution = _execution(bytes32(uint256(23)), ChallengeTypes.Side.A);
        execution.proposalDeadline = execution.observationTime;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidProposalDeadline.selector, challenger
        );
        execution = _execution(bytes32(uint256(24)), ChallengeTypes.Side.A);
        execution.disputeWindowSeconds = 0;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidDisputeWindow.selector, challenger
        );
        execution = _execution(bytes32(uint256(25)), ChallengeTypes.Side.A);
        execution.arbitrationWindowSeconds = 0;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidArbitrationWindow.selector, challenger
        );
        execution = _execution(bytes32(uint256(26)), ChallengeTypes.Side.A);
        execution.sourceCorrectionCutoff = execution.observationTime;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidSourceCorrectionCutoff.selector, challenger
        );
        execution = _execution(bytes32(uint256(27)), ChallengeTypes.Side.A);
        execution.sourceCorrectionCutoff = execution.proposalDeadline;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidSourceCorrectionCutoff.selector, challenger
        );
        execution = _execution(bytes32(uint256(28)), ChallengeTypes.Side.A);
        execution.disputeWindowSeconds = 100;
        execution.sourceCorrectionCutoff = execution.observationTime + 100;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidSourceCorrectionCutoff.selector, challenger
        );
        execution = _execution(bytes32(uint256(29)), ChallengeTypes.Side.A);
        execution.timeoutVoidAt = execution.proposalDeadline + execution.disputeWindowSeconds
            + execution.arbitrationWindowSeconds - 1;
        _expectCreateRevert(
            execution, ChallengeEscrowKernel.InvalidTimeoutVoidAt.selector, challenger
        );

        execution = _execution(bytes32(uint256(290)), ChallengeTypes.Side.A);
        execution.timeoutVoidAt = execution.proposalDeadline + execution.disputeWindowSeconds
            + execution.arbitrationWindowSeconds;
        bytes32 exactTimeoutSpecHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, exactTimeoutSpecHash);
    }

    function testCreateRejectsDuplicateChallengeAndInstanceNonceReplay() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(30)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.expectPartialRevert(ChallengeEscrowKernel.SpecHashMismatch.selector);
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, bytes32(0));
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, specHash);

        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeAlreadyExists.selector);
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, specHash);

        execution.stakeAmount += 1;
        bytes32 changedSpecHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.expectPartialRevert(ChallengeEscrowKernel.InstanceNonceAlreadyUsed.selector);
        vm.prank(challenger);
        release.createAndFund(execution, EVENT_TERMS_HASH, changedSpecHash);
    }

    function testAcceptanceRejectsEveryPermitBindingBoundary() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(31)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        bytes32 challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));

        permit.challengeId = bytes32(uint256(1));
        vm.expectPartialRevert(ChallengeEscrowKernel.PermitChallengeIdMismatch.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.challengeId = challengeId;
        permit.specHash = bytes32(uint256(2));
        vm.expectPartialRevert(ChallengeEscrowKernel.PermitSpecHashMismatch.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.specHash = specHash;
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotAcceptingWallet.selector);
        vm.prank(address(0xCAFE));
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.acceptanceNonce = 1;
        vm.expectPartialRevert(ChallengeEscrowKernel.PermitNonceMismatch.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.acceptanceNonce = 0;
        permit.expiresAt = 0;
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidPermitExpiry.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.expiresAt = execution.acceptanceDeadline + 1;
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidPermitExpiry.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
        permit.expiresAt = execution.acceptanceDeadline;
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidPermitSignature.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, bytes(""));
        (v, r, s) = vm.sign(ACCEPTOR_KEY, release.hashAcceptancePermit(permit));
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidPermitSigner.selector);
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function testLifecycleBoundariesRejectEarlyLateAndUnauthorizedActions() public {
        ChallengeTypes.ChallengeExecution memory openExecution =
            _execution(bytes32(uint256(32)), ChallengeTypes.Side.A);
        bytes32 openSpecHash = release.computeSpecHash(
            release.computeExecutionHash(openExecution), EVENT_TERMS_HASH
        );
        vm.prank(challenger);
        bytes32 openId = release.createAndFund(openExecution, EVENT_TERMS_HASH, openSpecHash);
        vm.warp(openExecution.acceptanceDeadline);
        vm.expectPartialRevert(ChallengeEscrowKernel.AcceptanceWindowClosed.selector);
        vm.prank(challenger);
        release.cancelOpen(openId);

        ChallengeTypes.ChallengeExecution memory activeExecution;
        bytes32 activeId;
        (activeId, activeExecution) = _active(bytes32(uint256(33)), ChallengeTypes.Side.A);
        vm.expectPartialRevert(ChallengeEscrowKernel.ObservationNotReached.selector);
        vm.prank(RESOLVER);
        release.propose(activeId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.warp(activeExecution.proposalDeadline);
        vm.expectPartialRevert(ChallengeEscrowKernel.ProposalWindowClosed.selector);
        vm.prank(RESOLVER);
        release.propose(activeId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);

        ChallengeTypes.ChallengeExecution memory correctionExecution;
        bytes32 correctionId;
        (correctionId, correctionExecution) = _active(bytes32(uint256(34)), ChallengeTypes.Side.A);
        vm.warp(correctionExecution.observationTime);
        vm.expectPartialRevert(ChallengeEscrowKernel.SourceCorrectionCutoffNotReached.selector);
        vm.prank(RESOLVER);
        release.propose(
            correctionId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA),
            EVENT_MATCH_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidOutcomeReason.selector);
        vm.warp(correctionExecution.sourceCorrectionCutoff);
        vm.prank(RESOLVER);
        release.propose(correctionId, ChallengeTypes.Outcome.VOID, 6, EVENT_MATCH_EVIDENCE_HASH);

        ChallengeTypes.ChallengeExecution memory proposedExecution;
        bytes32 proposedId;
        (proposedId, proposedExecution) = _active(bytes32(uint256(35)), ChallengeTypes.Side.A);
        vm.warp(proposedExecution.observationTime);
        vm.prank(RESOLVER);
        release.propose(proposedId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        uint64 disputeDeadline = release.getChallenge(proposedId).proposal.disputeDeadline;
        vm.expectPartialRevert(ChallengeEscrowKernel.DisputeDeadlineNotReached.selector);
        release.finalizeUncontested(proposedId);
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotParticipant.selector);
        vm.prank(address(0xCAFE));
        release.dispute(
            proposedId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.DisputeOutcomeUnchanged.selector);
        vm.prank(challenger);
        release.dispute(
            proposedId,
            ChallengeTypes.Outcome.A,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroEvidenceHash.selector);
        vm.prank(challenger);
        release.dispute(
            proposedId, ChallengeTypes.Outcome.B, 0, bytes32(0), EVENT_MATCH_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ParentEvidenceHashMismatch.selector);
        vm.prank(challenger);
        release.dispute(
            proposedId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            bytes32(uint256(1))
        );
        vm.warp(disputeDeadline);
        vm.expectPartialRevert(ChallengeEscrowKernel.DisputeWindowClosed.selector);
        vm.prank(challenger);
        release.dispute(
            proposedId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        release.finalizeUncontested(proposedId);
    }

    function testArbitrationBoundariesAndPermissionlessTimeout() public {
        ChallengeTypes.ChallengeExecution memory execution;
        bytes32 challengeId;
        (challengeId, execution) = _active(bytes32(uint256(36)), ChallengeTypes.Side.A);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(challengeId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.prank(challenger);
        release.dispute(
            challengeId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        ChallengeTypes.Challenge memory disputed = release.getChallenge(challengeId);
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotArbiter.selector);
        vm.prank(address(0xCAFE));
        release.arbitrate(
            challengeId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_MATCH_EVIDENCE_HASH,
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.SourceCorrectionCutoffNotReached.selector);
        vm.prank(ARBITER);
        release.arbitrate(
            challengeId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_MATCH_EVIDENCE_HASH,
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        vm.warp(disputed.dispute.arbitrationStart);
        vm.expectPartialRevert(ChallengeEscrowKernel.ZeroEvidenceHash.selector);
        vm.prank(ARBITER);
        release.arbitrate(
            challengeId, ChallengeTypes.Outcome.B, 0, bytes32(0), EVENT_ABSENCE_EVIDENCE_HASH
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ParentEvidenceHashMismatch.selector);
        vm.prank(ARBITER);
        release.arbitrate(
            challengeId, ChallengeTypes.Outcome.B, 0, EVENT_MATCH_EVIDENCE_HASH, bytes32(uint256(1))
        );
        vm.prank(ARBITER);
        release.arbitrate(
            challengeId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_MATCH_EVIDENCE_HASH,
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.RESOLVED_B);

        bytes32 voidId;
        (voidId, execution) = _active(bytes32(uint256(37)), ChallengeTypes.Side.A);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(voidId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.prank(challenger);
        release.dispute(
            voidId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        ChallengeTypes.Challenge memory voidDisputed = release.getChallenge(voidId);
        vm.warp(voidDisputed.dispute.arbitrationStart);
        vm.prank(ARBITER);
        release.arbitrate(
            voidId,
            ChallengeTypes.Outcome.VOID,
            uint8(ChallengeTypes.EvidenceVoidReason.INSUFFICIENT_DATA),
            EVENT_MATCH_EVIDENCE_HASH,
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        require(release.getChallenge(voidId).state == ChallengeTypes.LifecycleState.VOID);

        bytes32 timeoutId;
        (timeoutId, execution) = _active(bytes32(uint256(38)), ChallengeTypes.Side.A);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(timeoutId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.prank(challenger);
        release.dispute(
            timeoutId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_ABSENCE_EVIDENCE_HASH,
            EVENT_MATCH_EVIDENCE_HASH
        );
        ChallengeTypes.Challenge memory timeoutDisputed = release.getChallenge(timeoutId);
        vm.expectPartialRevert(ChallengeEscrowKernel.ArbitrationDeadlineNotReached.selector);
        release.voidUnarbitrated(timeoutId);
        vm.expectPartialRevert(ChallengeEscrowKernel.ArbitrationWindowClosed.selector);
        vm.warp(timeoutDisputed.dispute.arbitrationDeadline);
        vm.prank(ARBITER);
        release.arbitrate(
            timeoutId,
            ChallengeTypes.Outcome.B,
            0,
            EVENT_MATCH_EVIDENCE_HASH,
            EVENT_ABSENCE_EVIDENCE_HASH
        );
        release.voidUnarbitrated(timeoutId);
        require(release.getChallenge(timeoutId).state == ChallengeTypes.LifecycleState.VOID);
    }

    function testStateGuardsRejectMissingAndWrongLifecycle() public {
        bytes32 missing = bytes32(uint256(9999));
        ChallengeTypes.AcceptancePermit memory emptyPermit;
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.accept(missing, emptyPermit, bytes(""));
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.advanceAcceptanceNonce(missing);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.cancelOpen(missing);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.propose(missing, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.dispute(
            missing, ChallengeTypes.Outcome.B, 0, EVENT_ABSENCE_EVIDENCE_HASH, bytes32(0)
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.finalizeUncontested(missing);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.arbitrate(
            missing, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH, bytes32(0)
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.voidUnproposed(missing);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.voidUnarbitrated(missing);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        release.refundPrincipal(missing);

        ChallengeTypes.ChallengeExecution memory openExecution =
            _execution(bytes32(uint256(39)), ChallengeTypes.Side.A);
        bytes32 openSpecHash =
            release.computeSpecHash(release.computeExecutionHash(openExecution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        bytes32 openId = release.createAndFund(openExecution, EVENT_TERMS_HASH, openSpecHash);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotActive.selector);
        vm.prank(RESOLVER);
        release.propose(openId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH);

        ChallengeTypes.ChallengeExecution memory execution;
        bytes32 activeId;
        (activeId, execution) = _active(bytes32(uint256(40)), ChallengeTypes.Side.A);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotProposed.selector);
        release.finalizeUncontested(activeId);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotProposed.selector);
        release.dispute(
            activeId, ChallengeTypes.Outcome.B, 0, EVENT_ABSENCE_EVIDENCE_HASH, bytes32(0)
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotDisputed.selector);
        release.arbitrate(
            activeId, ChallengeTypes.Outcome.A, 0, EVENT_MATCH_EVIDENCE_HASH, bytes32(0)
        );
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotDisputed.selector);
        release.voidUnarbitrated(activeId);

        ChallengeTypes.AcceptancePermit memory challengerPermit = ChallengeTypes.AcceptancePermit({
            challengeId: openId,
            specHash: openSpecHash,
            acceptingWallet: challenger,
            acceptanceNonce: 0,
            expiresAt: openExecution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(challengerPermit));
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidAcceptingWallet.selector);
        vm.prank(challenger);
        release.accept(openId, challengerPermit, abi.encodePacked(r, s, v));
    }

    function _expectCreateRevert(
        ChallengeTypes.ChallengeExecution memory execution,
        bytes4 selector,
        address caller
    ) private {
        vm.expectPartialRevert(selector);
        vm.prank(caller);
        release.createAndFund(execution, EVENT_TERMS_HASH, bytes32(0));
    }

    function _setPaused(bool value) private {
        vm.prank(PAUSER);
        release.setPaused(value);
        require(release.paused() == value);
    }

    function _active(bytes32 nonce, ChallengeTypes.Side side)
        private
        returns (bytes32 challengeId, ChallengeTypes.ChallengeExecution memory execution)
    {
        execution = _execution(nonce, side);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), EVENT_TERMS_HASH);
        vm.prank(challenger);
        challengeId = release.createAndFund(execution, EVENT_TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function _execution(bytes32 nonce, ChallengeTypes.Side side)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory)
    {
        uint64 currentTime = uint64(block.timestamp);
        return ChallengeTypes.ChallengeExecution({
            nonce: nonce,
            createdAt: currentTime - 1,
            chainId: block.chainid,
            escrowContract: address(release),
            challengerWallet: challenger,
            challengerSide: side,
            token: address(token),
            tokenDecimals: 6,
            stakeAmount: STAKE,
            acceptanceDeadline: currentTime + 100,
            observationTime: currentTime + 200,
            sourceCorrectionCutoff: currentTime + 300,
            proposalDeadline: currentTime + 400,
            disputeWindowSeconds: 200,
            arbitrationWindowSeconds: 200,
            timeoutVoidAt: currentTime + 1_000
        });
    }

    function _refundBoth(bytes32 challengeId) private {
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        vm.prank(acceptor);
        release.refundPrincipal(challengeId);
    }

    function _decodeReleaseDeclared(bytes memory data)
        private
        pure
        returns (ReleaseDeclaredEventData memory eventData)
    {
        // Event data contains the flat non-indexed tuple; the struct decoder expects
        // the dynamic tuple's outer offset, so I add that ABI envelope explicitly.
        bytes memory wrapped = abi.encodePacked(bytes32(uint256(32)), data);
        eventData = abi.decode(wrapped, (ReleaseDeclaredEventData));
    }
}
